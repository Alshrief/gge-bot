if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Select",
                key: "eventDifficulty",
                selection: [
                    "Classic",
                    "Easy",
                    "Easy+",
                    "Intermediate",
                    "Intermediate+",
                    "Hard",
                    "Hard+",
                    "Expert",
                    "Expert+",
                    "Master",
                    "Master+",
                    "Archmaster"
                ],
                default: "4"
            },
            {
                type: "Checkbox",
                key: "lowValueChests",
                default: false
            },
            {
                type: "Checkbox",
                key: "noChests",
                default: false
            },
            {
                type: "Checkbox",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                key: "useCoin",
                default: false
            },
            {
                type: "Text",
                key: "commanderWhiteList",
                default: "1-99"
            },
            {
                type: "Text",
                key: "scoreShutoff"
            },
            {
                type: "Text",
                key: "customReinforcementLimit",
                default: ""
            },
            ...require("../../addons/attack/troopTypeOptions.js"),
            {
                type: "Checkbox",
                key: "attackLeft",
                default: true
            },
            {
                type: "Checkbox",
                key: "attackMiddle",
                default: true
            },
            {
                type: "Checkbox",
                key: "attackRight",
                default: true
            },
            {
                type: "Checkbox",
                key: "attackCourtyard",
                default: true
            },
        ]

    }
const err = require("../../err.json")
const { movementEvents, castles, ClientCommands, AreaType, KingdomID } = require('../../protocols.js')
const { waitToAttack, getAttackInfo, assignUnit, assignCustomTool, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave, getCombinedTroops, assignTroops, getMaxAttackers, getShieldCount } = require("../../addons/attack/attack.js")
const { isTroopResourceTypeAllowed, orderTroopsByTypePreference } = require("../../addons/attack/troopTypeFilter.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../../addons/commander.js")
const { sendXT, waitForResult, xtHandler, events, playerInfo, botConfig } = require("../../ggeBot.js")

const pretty = require('pretty-time')
const eventsDifficulties = require("../../items/eventAutoScalingDifficulties.json")


const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const kingdomID = KingdomID.greatEmpire
const type = AreaType.bloodcrowCastle
const minTroopCount = 1000
const eventID = 103
let eventPoints = 0
let hasInitialScore = false
let quit = false

const scoreShutoff = Number(pluginOptions.scoreShutoff ?? pluginOptions.eventScoreShutoff ?? 0) > 0
    ? Number(pluginOptions.scoreShutoff ?? pluginOptions.eventScoreShutoff)
    : Infinity

xtHandler.on("pep", obj => {
    if (obj.EID != eventID)
        return
    eventPoints = Number(obj.OP[0])
    hasInitialScore = true
    if (scoreShutoff > 0 && eventPoints >= scoreShutoff) {
        console.log("shuttingDownEvent", "scoreReached")
        quit = true
    }
})

events.on("eventStop", eventInfo => {
    if (eventInfo.EID != eventID)
        return

    if (quit)
        return

    console.log("shuttingDownEvent", "eventEnded")
    quit = true
})
events.on("eventStart", async eventInfo => {
    if (eventInfo.EID != eventID)
        return

    if (eventInfo.EDID == -1) {
        const eventDifficultyID =
            Number(eventsDifficulties.find(e =>
                ((pluginOptions.eventDifficulty)) == e.difficultyTypeID &&
                e.eventID == eventID)
                .difficultyID)

        await sendXT("sede", JSON.stringify({ EID: eventID, EDID: eventDifficultyID, C2U: 0 }))
        await waitForResult("sede", 1000 * 10)
        eventInfo.EDID = eventDifficultyID
    }
    let classic = false
    if (eventInfo.EDID == 0)
        classic = true

    const castle = castles.find(e => e.kingdomID == kingdomID && AreaType.mainCastle == e.areaInfo.type)

    const areas = (await ClientCommands.getAreaInfo(kingdomID,
        castle.areaInfo.x - 50, castle.areaInfo.y - 50,
        castle.areaInfo.x + 50, castle.areaInfo.y + 50)).areaInfo.filter(ai => ai.type == type)

    quit = false

    while (!quit) {
        if (!hasInitialScore) {
            await sendXT("pep", JSON.stringify({ EID: eventID }))
            await new Promise(resolve => {
                const onPep = obj => {
                    if (obj.EID != eventID)
                        return
                    cleanup()
                }
                const onStop = stopInfo => {
                    if (stopInfo.EID != eventID)
                        return
                    cleanup()
                }
                const cleanup = () => {
                    xtHandler.off("pep", onPep)
                    events.off("eventStop", onStop)
                    resolve()
                }
                xtHandler.on("pep", onPep)
                events.on("eventStop", onStop)
            })
        }

        if (quit) break

        if (scoreShutoff > 0 && eventPoints >= scoreShutoff) {
            console.log("shuttingDownEvent", "scoreReached")
            quit = true
            break
        }
        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList)
        try {
            const attackInfo = await waitToAttack(async () => {
                const areaInfo = areas.shift()

                areas.push(areaInfo)

                const level = 70

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerEventTools = []
                const attackerWallEventTools = []
                const attackerGateEventTools = []
                const attackerShieldEventTools = []
                const attackerMoatEventTools = []

                const attackerWallTools = []
                const attackerShieldTools = []
                const attackerGateTools = []
                const attackerMoatTools = []
                const attackerWallwagons = []

                const unitInv = castle.unitInventory ?? []
                for (let i = 0; i < unitInv.length; i++) {
                    const unit = unitInv[i]
                    if (unit.amount <= 0)
                        continue

                    if (unit.unitInfo.wodID == 277)
                        continue

                    if (unit.unitInfo.amountPerWave != undefined)
                        continue

                    if (unit.unitInfo.clientUsageEventID && !unit.unitInfo.clientUsageEventID.split(',').includes(`${eventID}`))
                        continue
                    // if(unit.unitInfo.filter(e => e[0].slotTypes.split(',').find(e => e == 9)) &&
                    //     unit.unitInfo.effects.split(',').find(e => e.split('&')[0] == 29))
                    //         attackerWallwagons.push(unit)
                    else if (unit.unitInfo.fameBonus != undefined) {
                        if (unit.unitInfo.gateBonus)
                            attackerGateEventTools.push(unit)
                        else if (unit.unitInfo.moatBonus)
                            attackerMoatEventTools.push(unit)
                        else if (unit.unitInfo.wallBonus)
                            attackerWallEventTools.push(unit)
                        else if (unit.unitInfo.defRangeBonus)
                            attackerShieldEventTools.push(unit)
                        else
                            attackerEventTools.push(unit)
                    }
                    else if (
                        unit.unitInfo.toolCategory &&
                        unit.unitInfo.usageEventID == undefined &&
                        unit.unitInfo.allowedToAttack == undefined &&
                        unit.unitInfo.typ == 'Attack'
                    ) {
                        if (unit.unitInfo.gateBonus)
                            attackerGateTools.push(unit)
                        else if (unit.unitInfo.moatBonus)
                            attackerMoatTools.push(unit)
                        else if (unit.unitInfo.wallBonus)
                            attackerWallTools.push(unit)
                        else if (unit.unitInfo.defRangeBonus)
                            attackerShieldTools.push(unit)
                    }
                    else if (unit.unitInfo.fightType == 0 &&
                        isTroopResourceTypeAllowed(unit.unitInfo, pluginOptions)) {
                        if (unit.unitInfo.role == "melee")
                            attackerMeleeTroops.push(unit)
                        else if (unit.unitInfo.role == "ranged")
                            attackerRangeTroops.push(unit)
                    }
                }

                let allTroopCount = 0

                orderTroopsByTypePreference(attackerMeleeTroops, pluginOptions)
                orderTroopsByTypePreference(attackerRangeTroops, pluginOptions)

                attackerRangeTroops.forEach(e => allTroopCount += e.amount)
                attackerMeleeTroops.forEach(e => allTroopCount += e.amount)

                if (allTroopCount < minTroopCount)
                    throw "NO_MORE_TROOPS"

                attackerEventTools.sort((a, b) =>
                    Number(b.unitInfo.fameBonus) - Number(a.unitInfo.fameBonus))
                attackerGateEventTools.sort((a, b) =>
                    Number(b.unitInfo.fameBonus) - Number(a.unitInfo.fameBonus))
                attackerWallEventTools.sort((a, b) =>
                    Number(b.unitInfo.fameBonus) - Number(a.unitInfo.fameBonus))
                attackerShieldEventTools.sort((a, b) =>
                    Number(b.unitInfo.fameBonus) - Number(a.unitInfo.fameBonus))
                attackerMoatEventTools.sort((a, b) =>
                    Number(b.unitInfo.fameBonus) - Number(a.unitInfo.fameBonus))
                // attackerWallwagons.sort((a,b) => {
                //     b.effects.split(',').find(e => e.split('&')[0] == 29).split('&')[1] -
                //     a.effects.split(',').find(e => e.split('&')[0] == 29).split('&')[1]
                // })
                if (pluginOptions.lowValueChests) {
                    attackerEventTools.reverse()
                    attackerGateEventTools.reverse()
                    attackerWallEventTools.reverse()
                    attackerShieldEventTools.reverse()
                    attackerMoatEventTools.reverse()
                }

                attackerWallTools.sort((a, b) =>
                    Number(b.unitInfo.wallBonus) - Number(a.unitInfo.wallBonus))
                attackerShieldTools.sort((a, b) =>
                    Number(b.unitInfo.defRangeBonus) - Number(a.unitInfo.defRangeBonus))
                attackerGateTools.sort((a, b) =>
                    Number(b.unitInfo.gateBonus) - Number(a.unitInfo.gateBonus))
                attackerMoatTools.sort((a, b) =>
                    Number(b.unitInfo.moatBonus) - Number(a.unitInfo.moatBonus))

                attackerWallEventTools.push(...attackerWallTools)
                attackerShieldEventTools.push(...attackerShieldTools)
                attackerGateEventTools.push(...attackerGateTools)
                attackerMoatEventTools.push(...attackerMoatTools)

                await sendXT("adi", JSON.stringify({
                    SX: castle.areaInfo.x,
                    SY: castle.areaInfo.y,
                    TX: areaInfo.x,
                    TY: areaInfo.y,
                    KID: kingdomID
                }))

                const [obj2, r2] = await waitForResult("adi", 1000 * 10)

                if (r2 != 0)
                    return

                const commanderStats = commander.getEffects(type, obj2.AE)
                const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, commander, level, undefined, pluginOptions, commanderStats.additionalWaves)

                const maxToolsFlank = getTotalAmountToolsFlank(level, commanderStats.additionalAttackToolAmountFlank)
                const maxToolsFront = getTotalAmountToolsFront(level)

                const maxTroopFront = getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)

                // Flank selection: if none selected or explicitly disabled
                const fillLeft   = pluginOptions.attackLeft !== false
                const fillMiddle = pluginOptions.attackMiddle !== false
                const fillRight  = pluginOptions.attackRight !== false
                const fillCourtyard = pluginOptions.attackCourtyard !== false

                const customWaves = pluginOptions.customWaves
                const useCustom = customWaves && customWaves.waves && (Array.isArray(customWaves.waves) || typeof customWaves.waves === 'object')

                const getWavePriority = (priority, waveIndex) => {
                    let resolved = priority
                    if (!resolved || resolved === 'default') {
                        resolved = (waveIndex === 0) ? 'ranged' : 'melee'
                    }
                    return resolved
                }

                attackInfo.A.forEach((wave, index) => {
                    let waveRemaining = getMaxAttackers(level, false)

                    if (useCustom) {
                        let waveConfig = null
                        if (index < 4) {
                            waveConfig = customWaves.waves[index]
                        } else if (customWaves.repeatWave4) {
                            waveConfig = customWaves.waves[3]
                        }
                        
                        if (!waveConfig || waveConfig.enabled === false) {
                            return
                        }

                        // Wave-specific flank activation check
                        // Note: GGE Left (wave.L) is UI Right flank, and GGE Right (wave.R) is UI Left flank.
                        const fillLeftForWave = fillLeft && waveConfig.L_enabled !== false // UI Left
                        const fillMiddleForWave = fillMiddle && waveConfig.M_enabled !== false // UI Middle
                        const fillRightForWave = fillRight && waveConfig.R_enabled !== false // UI Right

                        // Fill GGE Right (attacker's Left) with UI Left tools
                        let maxTools = maxToolsFlank
                        if (fillLeftForWave && waveConfig.L) {
                            wave.R.T.forEach((unitSlot, i) => {
                                const tool = waveConfig.L[i]
                                if (tool && tool.toolId) {
                                    maxTools -= assignCustomTool(unitSlot, tool.toolId, Math.min(tool.quantity, maxTools), castle.unitInventory, pluginOptions)
                                }
                            })
                        }

                        // Fill GGE Left (attacker's Right) with UI Right tools
                        maxTools = maxToolsFlank
                        if (fillRightForWave && waveConfig.R) {
                            wave.L.T.forEach((unitSlot, i) => {
                                const tool = waveConfig.R[i]
                                if (tool && tool.toolId) {
                                    maxTools -= assignCustomTool(unitSlot, tool.toolId, Math.min(tool.quantity, maxTools), castle.unitInventory, pluginOptions)
                                }
                            })
                        }

                        // Fill GGE Middle (attacker's Middle) with UI Middle tools
                        maxTools = maxToolsFront
                        if (fillMiddleForWave && waveConfig.M) {
                            wave.M.T.forEach((unitSlot, i) => {
                                const tool = waveConfig.M[i]
                                if (tool && tool.toolId) {
                                    maxTools -= assignCustomTool(unitSlot, tool.toolId, Math.min(tool.quantity, maxTools), castle.unitInventory, pluginOptions)
                                }
                            })
                        }

                        // GGE Right (attacker's Left) gets UI Left troops
                        if (fillLeftForWave) {
                            const wavePriority = getWavePriority(waveConfig.priority, index)
                            const combined = getCombinedTroops(attackerMeleeTroops, attackerRangeTroops, wavePriority, pluginOptions)
                            const assigned = assignTroops(wave.R.U, combined, Math.min(maxTroopFlank, waveRemaining))
                            waveRemaining -= assigned
                        }
                        // GGE Left (attacker's Right) gets UI Right troops
                        if (fillRightForWave) {
                            const wavePriority = getWavePriority(waveConfig.priority, index)
                            const combined = getCombinedTroops(attackerMeleeTroops, attackerRangeTroops, wavePriority, pluginOptions)
                            const assigned = assignTroops(wave.L.U, combined, Math.min(maxTroopFlank, waveRemaining))
                            waveRemaining -= assigned
                        }
                        // GGE Middle (attacker's Middle) gets UI Middle troops
                        if (fillMiddleForWave) {
                            const wavePriority = getWavePriority(waveConfig.priority, index)
                            const combined = getCombinedTroops(attackerMeleeTroops, attackerRangeTroops, wavePriority, pluginOptions)
                            const assigned = assignTroops(wave.M.U, combined, Math.min(maxTroopFront, waveRemaining))
                            waveRemaining -= assigned
                        }
                        return
                    }

                    let maxTools = maxToolsFlank
                    if (index == 0) {
                        if (fillLeft) {
                            wave.R.T.forEach((unitSlot, i) => {
                                const desiredToolCount = i == 0 ? 15 : 99
                                const tool = i == 0 ? attackerWallEventTools : attackerMoatEventTools

                                maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                            })
                        }
                        maxTools = maxToolsFlank
                        if (fillRight) {
                            wave.L.T.forEach((unitSlot, i) => {
                                const desiredToolCount = i == 0 ? 15 : 99
                                const tool = i == 0 ? attackerWallEventTools : attackerMoatEventTools

                                maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                            })
                        }

                        maxTools = maxToolsFront
                        if (fillMiddle) {
                            wave.M.T.forEach((unitSlot, i) => {
                                const desiredToolCount = i == 0 ? 15 :
                                    i == 1 ? 15 : 99
                                const tool = i == 0 ? attackerWallEventTools :
                                    i == 1 ? attackerGateEventTools : attackerMoatEventTools

                                maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                            })
                        }

                        if (fillLeft) {
                            let maxTroops = Math.min(maxTroopFlank, waveRemaining)
                            wave.R.U.forEach((unitSlot, i) => {
                                const assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops)
                                maxTroops -= assigned
                                waveRemaining -= assigned
                            })
                        }
                        if (fillRight) {
                            let maxTroops = Math.min(maxTroopFlank, waveRemaining)
                            wave.L.U.forEach((unitSlot, i) => {
                                const assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops)
                                maxTroops -= assigned
                                waveRemaining -= assigned
                            })
                        }
                        if (fillMiddle) {
                            let maxTroops = Math.min(maxTroopFront, waveRemaining)
                            wave.M.U.forEach((unitSlot, i) => {
                                const assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops)
                                maxTroops -= assigned
                                waveRemaining -= assigned
                            })
                        }
                        return
                    }
                    else if (index == 1) {
                        if (fillLeft) {
                            wave.R.T.forEach((unitSlot, i) => {
                                const desiredToolCount = i == 0 ? 15 : 99
                                const tool = i == 0 ? attackerWallEventTools : attackerShieldEventTools

                                maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                            })
                        }
                        maxTools = maxToolsFlank
                        if (fillRight) {
                            wave.L.T.forEach((unitSlot, i) => {
                                const desiredToolCount = i == 0 ? 15 : 99
                                const tool = i == 0 ? attackerWallEventTools : attackerShieldEventTools

                                maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                            })
                        }

                        maxTools = maxToolsFront
                        if (fillMiddle) {
                            wave.M.T.forEach((unitSlot, i) => {
                                const desiredToolCount = i == 0 ? 10 :
                                    i == 1 ? 10 : 99
                                const tool = i == 0 ? attackerWallEventTools :
                                    i == 1 ? attackerGateEventTools : attackerShieldEventTools

                                maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                            })
                        }

                        if (fillLeft) {
                            let maxTroops = Math.min(maxTroopFlank, waveRemaining)
                            wave.R.U.forEach(unitSlot => {
                                const assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops)
                                maxTroops -= assigned
                                waveRemaining -= assigned
                            })
                        }
                        if (fillRight) {
                            let maxTroops = Math.min(maxTroopFlank, waveRemaining)
                            wave.L.U.forEach(unitSlot => {
                                const assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops)
                                maxTroops -= assigned
                                waveRemaining -= assigned
                            })
                        }
                        if (fillMiddle) {
                            let maxTroops = Math.min(maxTroopFront, waveRemaining)
                            wave.M.U.forEach(unitSlot => {
                                const assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops)
                                maxTroops -= assigned
                                waveRemaining -= assigned
                            })
                        }

                        attackerMeleeTroops.sort((a, b) => Number(a.unitInfo.meleeAttack) - Number(b.unitInfo.meleeAttack))
                        attackerRangeTroops.sort((a, b) => Number(a.unitInfo.rangeAttack) - Number(b.unitInfo.rangeAttack))
                        return
                    }
                    else if (!pluginOptions.noChests) {
                        const selectTool = i => {
                            let tools = pluginOptions.eventWallToolsFirst ? [] : attackerEventTools
                            if (tools.length == 0) {
                                if (i == 0) {
                                    tools = attackerWallEventTools
                                    if (tools.length == 0)
                                        tools = attackerShieldEventTools
                                }
                                else if (i == 1) {
                                    tools = attackerShieldEventTools
                                    if (tools.length == 0)
                                        tools = attackerWallEventTools
                                }
                                if (i == 2) {
                                    tools = attackerGateEventTools
                                    if (tools.length == 0)
                                        tools = attackerWallEventTools
                                    if (tools.length == 0)
                                        tools = attackerShieldEventTools
                                }
                            }

                            return tools
                        }

                        if (fillLeft) {
                            wave.R.T.forEach(unitSlot =>
                                maxTools -= assignUnit(unitSlot, selectTool(0), maxTools))
                        }
                        maxTools = maxToolsFlank
                        if (fillRight) {
                            wave.L.T.forEach(unitSlot =>
                                maxTools -= assignUnit(unitSlot, selectTool(1), maxTools))
                        }
                        maxTools = maxToolsFront
                        if (fillMiddle) {
                            wave.M.T.forEach(unitSlot =>
                                maxTools -= assignUnit(unitSlot, selectTool(2), maxTools))
                        }
                    }

                    if (fillLeft) {
                        let maxTroops = Math.min(maxTroopFlank, waveRemaining)
                        wave.R.U.forEach(unitSlot => {
                            const assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops)
                            maxTroops -= assigned
                            waveRemaining -= assigned
                        })
                    }
                    if (fillRight) {
                        let maxTroops = Math.min(maxTroopFlank, waveRemaining)
                        wave.L.U.forEach(unitSlot => {
                            const assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops)
                            maxTroops -= assigned
                            waveRemaining -= assigned
                        })
                    }
                    if (fillMiddle) {
                        let maxTroops = Math.min(maxTroopFront, waveRemaining)
                        wave.M.U.forEach(unitSlot => {
                            const assigned = assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops)
                            maxTroops -= assigned
                            waveRemaining -= assigned
                        })
                    }
                })

                let customLimit = Number.parseInt(pluginOptions.customReinforcementLimit)
                let maxTroops = Number.isInteger(customLimit) && customLimit > 0 ? customLimit : getMaxUnitsInReinforcementWave(playerInfo.level, level, true, commanderStats.attackUnitAmountReinforcementBonus, commanderStats.attackUnitAmountReinforcementBoost)
                if (fillCourtyard) {
                    attackInfo.RW.forEach((unitSlot, i) => {
                        let attacker = i & 1 ?
                            (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops) :
                            (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)

                        maxTroops -= assignUnit(unitSlot, attacker, maxTroops)
                    })
                }

                await sendXT("cra", JSON.stringify(attackInfo))

                let [obj, result] = await waitForResult("cra", 1000 * 10, (obj, result) => {
                    if (result != 0)
                        return true

                    if (obj.AAM.M.KID != kingdomID || obj.AAM.M.TA[1] != areaInfo.x || obj.AAM.M.TA[2] != areaInfo.y)
                        return false
                    return true
                })

                if (result != 0)
                    throw err[result]

                return obj
            })
            if (!attackInfo) {
                freeCommander(commander.lordID)
                continue
            }


            console.info("hittingTargetAttack", 'C', attackInfo.AAM.UM.L.VIS + 1, ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
        } catch (e) {
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
                    await new Promise(resolve => movementEvents.on("return", function self(/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) {
                        if (movement.kingdomID != kingdomID || movement.targetAttack.extraData[0] != castle.id)
                            return

                        movementEvents.off("return", self)
                        resolve()
                    }))
                    break
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "ATTACK_TOO_MANY_UNITS":
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "MISSING_UNITS":
                case "CANT_START_NEW_ARMIES":
                case "NO_PLAYER_SPAWNED_YET":
                case "INVALID_POSITION":
                case "NOT_ENOUGH_CURRENCY1":
                    console.debug("attackBloodcrows retryable:", e)
                    break
                default:
                    console.error(e)
                    quit = true
            }
        }
    }
})