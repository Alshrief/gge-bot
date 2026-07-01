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
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                key: "useCoin",
                default: false
            },
            ...require("../../addons/attack/troopTypeOptions.js"),
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
            {
                type: "Checkbox",
                key: "attackLv1",
                default: false
            },
            {
                type: "Checkbox",
                key: "attackLv2",
                default: false
            },
            {
                type: "Checkbox",
                key: "attackLv3",
                default: false
            },
            {
                type: "Checkbox",
                key: "attackLv4",
                default: false
            },
            ...require("../../addons/timeSkipsPluginOptions.js")
        ]

    }

const err = require("../../err.json")
const { spendSkip } = require("../../addons/skips.js")
const { movementEvents, ClassTypes, ClientCommands, AreaType, KingdomID, castles } = require('../../protocols.js')
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave } = require("../../addons/attack/attack.js")
const { isTroopResourceTypeAllowed, orderTroopsByTypePreference } = require("../../addons/attack/troopTypeFilter.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../../addons/commander.js")
const { sendXT, waitForResult, xtHandler, events, playerInfo, botConfig } = require("../../ggeBot.js")

const eventAutoScalingCamps = require("../../items/eventAutoScalingCamps.json")
const pretty = require('pretty-time')

const daimyoCastlesClassic = require("../../items/daimyoCastles.json")
const ggeConfig = require("../../ggeConfig.json")
const eventsDifficulties = require("../../items/eventAutoScalingDifficulties.json")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const kingdomID = KingdomID.greatEmpire
const type = AreaType.daimyoCastle
const minTroopCount = 1000
const eventID = 80
let eventPoints = 0

const skipTarget = async areaInfo => {
    if (!pluginOptions.useTimeSkips) return
    while (areaInfo.extraData[2] > 0) {
        let skip = spendSkip(areaInfo.extraData[2], pluginOptions)

        if (skip == undefined)
            throw new Error("couldntFindSkip")

        const { result } = await ClientCommands.skipTarget(type, areaInfo.x, areaInfo.y, kingdomID, skip)

        if (result != 0)
            break
    }
}

movementEvents.on("returning", (/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) => {
    if (movement.targetOwner?.ownerID != playerInfo.playerID)
        return

    if (movement.sourceAttack.type != type)
        return

    skipTarget(movement.sourceAttack)
})

let quit = false
let hasInitialScore = false

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

    if (eventInfo.EDID == -1 && !(ggeConfig.classicBug && pluginOptions.eventDifficulty == 0)) {
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
    if ([0, -1].includes(eventInfo.EDID))
        classic = true

    const castle = castles.find(e => e.kingdomID == kingdomID && AreaType.mainCastle == e.areaInfo.type)

    let areas = (await ClientCommands.getAreaInfo(kingdomID,
                castle.areaInfo.x - 50, castle.areaInfo.y - 50,
                castle.areaInfo.x + 50, castle.areaInfo.y + 50)).areaInfo.filter(ai => ai.type == type)

    quit = false

    if (areas.length == 0) {
        quit = true
        console.log("You need a level 70 account or higher to use this.")
    }

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
        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList,
            classic ? commander => commander.getEffects().AttackSupportUnits : undefined,
            (a, b) => (b.getEffects().cooldownReduction ?? 0) - (a.getEffects().cooldownReduction ?? 0))
        try {
            const attackInfo = await waitToAttack(async () => {
                const areaInfo = areas.shift()

                areas.push(areaInfo)

                await skipTarget(areaInfo)
                const campInfo = classic ? daimyoCastlesClassic.find(obj => areaInfo.extraData[1] == obj.id) :
                    eventAutoScalingCamps.find(obj => areaInfo.extraData[5] == obj.eventAutoScalingCampID)

                const level = Number(classic ? campInfo.level : campInfo.camplevel)

                if (![
                    pluginOptions.attackLv1 ? 1 : undefined,
                    pluginOptions.attackLv2 ? 2 : undefined,
                    pluginOptions.attackLv3 ? 3 : undefined,
                    pluginOptions.attackLv4 ? 4 : undefined,
                ].includes(Number(campInfo.rank)))
                    return

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerWallTools = []
                const attackerGateTools = []
                const attackerShieldTools = []
                const attackerMoatTools = []

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

                    if (
                        unit.unitInfo.toolCategory &&
                        unit.unitInfo.usageEventID == undefined &&
                        unit.unitInfo.allowedToAttack == undefined &&
                        unit.unitInfo.typ == 'Attack' &&
                        unit.unitInfo.fameBonus == undefined
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

                attackerWallTools.sort((a, b) =>
                    Number(b.unitInfo.wallBonus) - Number(a.unitInfo.wallBonus))
                attackerShieldTools.sort((a, b) =>
                    Number(b.unitInfo.defRangeBonus) - Number(a.unitInfo.defRangeBonus))
                attackerGateTools.sort((a, b) =>
                    Number(b.unitInfo.gateBonus) - Number(a.unitInfo.gateBonus))
                attackerMoatTools.sort((a, b) =>
                    Number(b.unitInfo.moatBonus) - Number(a.unitInfo.moatBonus))

                if (!classic) {
                    await sendXT("adi", JSON.stringify({
                        SX: castle.areaInfo.x,
                        SY: castle.areaInfo.y,
                        TX: areaInfo.x,
                        TY: areaInfo.y,
                        KID: kingdomID
                    }))
                    var [obj2, r2] = await waitForResult("adi", 1000 * 10)

                    if (r2 != 0)
                        return
                }
                const commanderStats = commander.getEffects(type, obj2?.AE)

                const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, commander, level, classic ? 1 : undefined, pluginOptions, commanderStats.additionalWaves)

                const maxToolsFlank = getTotalAmountToolsFlank(level, commanderStats.additionalAttackToolAmountFlank)
                const maxToolsFront = getTotalAmountToolsFront(level)

                const maxTroopFront = classic ? 1 : getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                const maxTroopFlank = classic ? 1 : getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)

                attackInfo.A.forEach((wave, index) => {
                    let maxTools = maxToolsFlank
                    if (index == 0 && !classic) {
                        wave.L.T.forEach((unitSlot, i) => {
                            const desiredToolCount = i == 0 ? 15 : 99
                            const tool = i == 0 ? attackerWallTools : attackerShieldTools

                            maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                        })
                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) => {
                            const desiredToolCount = i == 0 ? 15 : 99
                            const tool = i == 0 ? attackerWallTools : attackerShieldTools

                            maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                        })

                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) => {
                            const desiredToolCount = i == 0 ? 10 :
                                i == 1 ? 10 : 99
                            const tool = i == 0 ? attackerWallTools :
                                i == 1 ? attackerGateTools : attackerShieldTools

                            maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                        })

                        let maxTroops = maxTroopFlank

                        wave.L.U.forEach(unitSlot =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        maxTroops = maxTroopFlank
                        wave.R.U.forEach(unitSlot =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))

                        attackerMeleeTroops.sort((a, b) => Number(a.unitInfo.meleeAttack) - Number(b.unitInfo.meleeAttack))
                        attackerRangeTroops.sort((a, b) => Number(a.unitInfo.rangeAttack) - Number(b.unitInfo.rangeAttack))
                        return
                    }

                    let maxTroops = maxTroopFlank

                    wave.L.U.forEach(unitSlot =>
                        maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                            attackerMeleeTroops : attackerRangeTroops, maxTroops))
                    maxTroops = maxTroopFlank
                    wave.R.U.forEach(unitSlot =>
                        maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                            attackerMeleeTroops : attackerRangeTroops, maxTroops))
                    maxTroops = maxTroopFront
                    wave.M.U.forEach(unitSlot =>
                        maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                            attackerRangeTroops : attackerMeleeTroops, maxTroops))
                })

                let customLimit = Number.parseInt(pluginOptions.customReinforcementLimit)
                let maxTroops = classic ? 10 : (Number.isInteger(customLimit) && customLimit > 0 ? customLimit : getMaxUnitsInReinforcementWave(playerInfo.level, level, true, commanderStats.attackUnitAmountReinforcementBonus, commanderStats.attackUnitAmountReinforcementBoost))
                attackInfo.RW.forEach((unitSlot, i) => {
                    let attacker = i & 1 ?
                        (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops) :
                        (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops)

                    maxTroops -= assignUnit(unitSlot, attacker, maxTroops)
                })

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
                    console.debug("attackDaimyo retryable:", e)
                    break
                default:
                    console.error(e)
                    quit = true
            }
        }
    }
})
