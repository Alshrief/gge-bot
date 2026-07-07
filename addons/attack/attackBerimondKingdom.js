if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "commanderWhiteList",
                default: "1-99"
            },
            {
                type: "Checkbox",
                key: "recruitBerimondUnits",
                default: true
            },
            {
                type: "Checkbox",
                key: "buildUnitCamp",
                default: true
            },
            {
                type: "Checkbox",
                key: "upgradeUnitCamps",
                default: false
            },
            {
                type: "Checkbox",
                key: "lowValueChests",
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
                default: true
            },
            {
                type: "Checkbox",
                key: "buyTools",
                default: true
            },
            {
                type: "Text",
                key: "buyAmount",
                default: "300"
            },
            {
                type: "Text",
                key: "buyThreshold",
                default: "50"
            },
            {
                type: "Text",
                key: "maxShieldBuyLimit",
                default: "2000"
            },
            {
                type: "Checkbox",
                key: "allowWoodShields",
                default: true
            },
            {
                type: "Checkbox",
                key: "allowIronShields",
                default: true
            },
            {
                type: "Checkbox",
                key: "allowEventShields",
                default: true
            },
            {
                type: "Checkbox",
                key: "sendTroopsOver",
                default: true
            },
            {
                type: "Checkbox",
                key: "noEventTools",
                default: false
            },
            {
                type: "Checkbox",
                key: "noEventChests",
                default: false
            },
            {
                type: "Text",
                key: "wallTools",
                default: "5"
            },
            {
                type: "Text",
                key: "gateTools",
                default: "5"
            },
            {
                type: "Text",
                key: "shieldTools",
                default: "25"
            },
            {
                type: "Text",
                key: "troopCount",
                default: "32"
            },
            {
                type: "Text",
                key: "minTroopsTransferThreshold",
                default: "150"
            },
            {
                type: "Text",
                key: "minTroopsTransferSize",
                default: "100"
            },
            {
                type: "Checkbox",
                key: "allowRelicShortbow",
                default: true
            },
            {
                type: "Checkbox",
                key: "allowEliteheavycrossbowman",
                default: true
            },
            {
                type: "Checkbox",
                key: "allowElitekingscrossbowman",
                default: true
            },
            {
                type: "Checkbox",
                key: "allowElitelongbowman",
                default: false
            },
            {
                type: "Checkbox",
                key: "allowHorrificRanged",
                default: true
            },
            {
                type: "Checkbox",
                key: "allowHorrificRangedVeteran",
                default: true
            },
            {
                type: "Checkbox",
                key: "allowHorrificMelee",
                default: false
            },
            {
                type: "Checkbox",
                key: "allowHorrificMeleeVeteran",
                default: false
            },
            {
                type: "Checkbox",
                key: "allowNomadAttackerRange",
                default: true
            },
            {
                type: "Checkbox",
                key: "allowSamuraiAttackerRange",
                default: true
            },
            {
                type: "Select",
                key: "attackFlank",
                selection: [
                    "Left Flank",
                    "Right Flank",
                    "Front Flank"
                ],
                default: "0"
            },
            ...require("../../addons/timeSkipsPluginOptions.js"),
            ...require("../../addons/attack/troopTypeOptions.js"),
        ]
    }

const pretty = require('pretty-time')
const { spendSkip } = require("../../addons/skips.js")
const { movementEvents, movements, ClassTypes, ClientCommands, AreaType, KingdomID, KingdomSkipType, castles, unlockInfoList, setCastle } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront } = require("../../addons/attack/attack")
const { isTroopResourceTypeAllowed, orderTroopsByTypePreference } = require("../../addons/attack/troopTypeFilter.js")
const { waitForCommanderAvailable, useCommander, freeCommander } = require("../../addons/commander")
const { sendXT, waitForResult, events, botConfig } = require("../../ggeBot.js")
const err = require('../../err.json')
const units = require("../../items/units.json")
const buildings = require("../../items/buildings.json")
const { upgradeBuilding, canAffordBuilding, placeBuilding, hasFreeConstructionSlot, expandCastle } = require('../buildings.js')

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const fs = require('fs')

function getShieldCounterFile() {
    return `./berimond_shield_counter_${botConfig.id}.json`
}

function loadShieldCounter(eventInfo) {
    try {
        const file = getShieldCounterFile()
        if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'))
            // Accept if EID matches; TE check is optional for backward-compat with old saved files
            const eidMatch = data.EID === eventInfo.EID
            const teMatch = data.TE === undefined || data.TE === eventInfo.TE
            if (eidMatch && teMatch) {
                return Number(data.purchasedShields || 0)
            }
        }
    } catch (e) {
        console.debug("Failed to load shield counter:", e)
    }
    return 0
}

function saveShieldCounter(count, eventInfo) {
    try {
        const file = getShieldCounterFile()
        fs.writeFileSync(file, JSON.stringify({
            purchasedShields: count,
            EID: eventInfo.EID,
            TE: eventInfo.TE
        }, null, 2), 'utf8')
    } catch (e) {
        console.debug("Failed to save shield counter:", e)
    }
}

const troopBlackList = [277]
const kingdomID = KingdomID.berimond
const type = AreaType.watchTower
const minTroopCount = 26
const eventID = 3

// FactionUnittent — the troop-capacity "camp" tent for Berimond Kingdom (kIDs 10 / eventID 3).
// Chain: 242 (lvl1) -> 11 (lvl2) -> 243 (lvl3) -> 12 (lvl4)
const unitCampWodID = 242
const unitCampChain = [242, 11, 243, 12]

// Returns true if the building costs only wood/stone (no rubies/premium resources)
function isCampAffordableWithWoodAndStone(buildingInfo) {
    const rubyFields = ["costC2", "costC1", "costAquamarine", "costGlass", "costIron",
        "costOil", "costCoal", "costLegendaryToken", "costLegendaryMaterial", "costPlaster",
        "costDragonScaleTile", "costImperialDucat", "costGoldToken", "costFloraToken",
        "costCommonStraw", "costSceatToken", "costRareNails", "costRareGlue"]
    return rubyFields.every(field => Number(buildingInfo[field] ?? 0) === 0)
}

function getBerimondTroopCountSetting() {
    const parsed = Number(pluginOptions.troopCount ?? minTroopCount)
    return Number.isFinite(parsed) ? Math.max(minTroopCount, Math.floor(parsed)) : minTroopCount
}

let quit = false
let isFillingTroops = false
let foundAllBeri = false
let list = []
let startBeri = 627

while (!foundAllBeri) {
    let item = buildings.find(e => e?.wodID == startBeri)
    list.push(item.wodID)
    if (!item.upgradeWodID)
        foundAllBeri = true
    if (startBeri == item.upgradeWodID)
        throw Error("Recursion")
    startBeri = item.upgradeWodID
}

async function kingdomSendTroops(sourceKingdom, targetKingdom, sendTroops) {
    await sendXT("kut", JSON.stringify({
        SCID: sourceKingdom.id,
        SKID: sourceKingdom.kingdomID,
        TKID: targetKingdom.kingdomID,
        CID: -1,
        A: sendTroops
    }))
    return waitForResult("kut", 1000 * 10)
}


const recruitTroops = castle => setCastle(castle, async () => {
    try {
        if (quit)
            return
        if (pluginOptions.recruitBerimondUnits === false)
            return

        const { wodID } = castle.buildings.find(e => list.includes(e.wodID))

        await sendXT("spl", JSON.stringify({ LID: 3 }))
        const obj2 = (await waitForResult("spl", 1000 * 10))[0]
        let troopsRecruited = 0

        for (let i = 0; i < obj2.QS.length; i++) {
            const obj4 = obj2.QS[i]

            if (obj4.P)
                continue
            if (obj4.SI.RUT == 0)
                continue

            let troopLimit = castle.getProductionData.maxAuxilariesTroops

            troopLimit -= troopsRecruited
            troopLimit -= (castle.unitInventory ?? []).reduce((lastReturn, object) =>
                units.find(obj => object.unitInfo.wodID == obj?.wodID)?.isAuxiliary ?
                    lastReturn + Number(object.amount) : lastReturn, 0)

            troopLimit -= obj2.QS.reduce((lastReturn, object) =>
                object.P?.TUA ? lastReturn + object.P.TUA : lastReturn, 0)

            const stackSize = Math.min(troopLimit, Number(buildings.find(e => e?.wodID == wodID)?.stackSize))

            if (stackSize <= 0) {
                console.log("couldNotRecruitReason", "couldNotRecruitReasonTroopLimitReached")
                setTimeout(recruitTroops, 60 * 5 * 1000, castle)
                return
            }

            await sendXT("bup", JSON.stringify({
                LID: 3,
                WID: 14,
                AMT: stackSize,
                PO: -1,
                PWR: 0,
                SK: 73,
                SID: 10,
                AID: castle.id
            }))

            if ((await waitForResult("bup", 1000 * 10))[1] != 0) {
                console.warn("failedToRecruitTroops", `KID:${kingdomID} AID:${castle.id}`)
                setTimeout(recruitTroops, 60 * 5 * 1000, castle)
                return
            }
            troopsRecruited += stackSize
        }

        console.log(troopsRecruited, "recruitedTroops")
        setTimeout(recruitTroops, 60 * 5 * 1000, castle)
    } catch (e) {
        console.warn("[بيريموند] فشل تحديث أو تدريب القوات مؤقتاً بسبب خطأ أو مهلة اتصال:", e)
        setTimeout(recruitTroops, 60 * 5 * 1000, castle)
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
const skipResource = async castle => {
    if (!pluginOptions.useTimeSkips) return
    while (castle.troopTransfer?.remainingTime > 0) {
        let skip = spendSkip(castle.troopTransfer.remainingTime, pluginOptions)

        if (skip == undefined)
            throw new Error("couldntFindSkip")


        if (await ClientCommands.kingdomUnitTransfer(skip, kingdomID, KingdomSkipType.sendTroops) != 0)
            return
    }
}
events.on("eventStart", async eventInfo => {
    if (eventInfo.EID != eventID)
        return
    const mainCastle = castles.find(e => e.kingdomID == KingdomID.greatEmpire && e.areaInfo.type == AreaType.mainCastle)

    if (!unlockInfoList.find(e => e.kingdomID == kingdomID)?.isUnlocked) {
        if (mainCastle.wood < 9000 || mainCastle.stone < 9000)
            return console.warn("couldNotOpenBerimond")

        await sendXT("fsc", JSON.stringify({ ID: 2, PWR: 0, OC2: 0, SID: 10 }))
        await waitForResult("fjf", 1000 * 10)
    }

    const castle = castles.find(e => e.kingdomID == kingdomID && e.areaInfo.type == AreaType.beriCastle)
    // لو upgradeUnitCamps مفعّل بس buildUnitCamp مش مفعّل → لا يبني ولا يرقي
    const campBuildEnabled = pluginOptions.buildUnitCamp !== false
    const campUpgradeEnabled = pluginOptions.upgradeUnitCamps === true

    // دالة مستقلة لبناء وترقية المخيمات بالترتيب الصحيح:
    // 1) يوسع القلعة لأقصى حد
    // 2) يبني مخيمات لأقصى عدد ممكن
    // 3) يرقي المخيمات بعد اكتمال البناء (لو الترقية مفعّلة)
    const manageCamps = () => setCastle(castle, async () => {
        if (!campBuildEnabled && !campUpgradeEnabled)
            return
        // لو الترقية مفعّلة بس البناء لأ → لا تعمل شيء
        if (!campBuildEnabled)
            return
        try {
            const unitCampInfo = buildings.find(e => e?.wodID == unitCampWodID)
            if (!unitCampInfo) return

            // --- المرحلة 1: بناء المخيمات (يوسع ثم يبني بشكل متناوب) ---
            let builtAny = false
            // حاول التوسعة والبناء بشكل متناوب حتى ما يقدرش يبني أكتر
            while (true) {
                // أولاً: حاول توسيع القلعة (لو فشلت أو انتهت مهلتها، نكمل للبناء)
                try {
                    const expanded = await expandCastle(castle)
                    if (expanded) {
                        console.log("[بيريموند] تم توسيع القلعة")
                        castle.emit("resourceUpdate")
                    }
                } catch (expandErr) {
                    console.debug("[بيريموند] فشل توسيع القلعة (سنكمل للبناء):", expandErr.message)
                }

                // ثانياً: حاول بناء مخيم جديد
                const alreadyBuiltCount = castle.buildings.filter(b => unitCampChain.includes(b.wodID)).length
                const hasFreeSlot = hasFreeConstructionSlot(castle)
                const canAfford = isCampAffordableWithWoodAndStone(unitCampInfo) && canAffordBuilding(castle, unitCampInfo)

                if (!hasFreeSlot || !canAfford) {
                    // إذا لم يستطع بناء مخيم جديد، اخرج من الحلقة
                    break
                }

                try {
                    const ownerID = await placeBuilding(castle, unitCampWodID)
                    console.log("[بيريموند] تم بناء مخيم جديد، ownerID:", ownerID)
                    builtAny = true
                    castle.emit("resourceUpdate")
                } catch (buildErr) {
                    // NO_FREE_CONSTRUCTION_SLOTS أو NOT_ENOUGH_RESOURCE أو NO_VALID_POSITION → توقف
                    console.log("[بيريموند] توقف بناء المخيمات:", buildErr.message || buildErr)
                    break
                }
            }

            // --- المرحلة 2: ترقية المخيمات (بعد اكتمال البناء) ---
            if (campUpgradeEnabled) {
                while (true) {
                    const upgradableCamps = castle.buildings.filter(b => {
                        if (!unitCampChain.includes(b.wodID)) return false
                        const info = buildings.find(e => e?.wodID == b.wodID)
                        return info?.upgradeWodID != null
                    })

                    let upgradedAny = false
                    for (const campBuilding of upgradableCamps) {
                        const info = buildings.find(e => e?.wodID == campBuilding.wodID)
                        const nextInfo = buildings.find(e => e?.wodID == info?.upgradeWodID)
                        if (!nextInfo) continue
                        if (!isCampAffordableWithWoodAndStone(nextInfo)) continue
                        if (!canAffordBuilding(castle, nextInfo)) continue
                        if (!hasFreeConstructionSlot(castle)) continue

                        try {
                            await upgradeBuilding(castle, campBuilding.ownerID)
                            console.log("[بيريموند] تم ترقية مخيم ownerID:", campBuilding.ownerID)
                            upgradedAny = true
                            castle.emit("resourceUpdate")
                            break // اخرج من حلقة المعسكرات لإعادة فحص القائمة بعد الترقية
                        } catch (upErr) {
                            console.debug("[بيريموند] فشل ترقية المخيم:", upErr.message)
                        }
                    }

                    if (!upgradedAny) {
                        break
                    }
                }
            }
        } catch (e) {
            console.debug("[بيريموند] manageCamps error:", e.message ?? e)
        }
    })
    castle.on("resourceUpdate", manageCamps)
    manageCamps()

    const refreshTimer = setInterval(async () => {
        if (quit) {
            clearInterval(refreshTimer)
            return
        }
        try {
            await sendXT("dcl", JSON.stringify({ CD: 1 }))
            await waitForResult("dcl", 1000 * 10)
        } catch (e) {
            console.debug("Periodic dcl refresh failed:", e)
        }
    }, 5 * 60 * 1000).unref()

    if (pluginOptions.sendTroopsOver) {
        await skipResource(castle)
    }

    quit = false

    recruitTroops(castle)

    while (!quit) {
        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList,
            undefined,
            (a, b) => {
                let ret = b.getEffects().speedBonus - a.getEffects().speedBonus
                if (ret == 0)
                    ret = b.getEffects(type).offensiveRangeBonus - a.getEffects(type).offensiveRangeBonus
                return ret
            })
        try {
            const attackInfo = await waitToAttack(async () => {
                const getObj = await ClientCommands.getNextMapObject(type, kingdomID) //check if burning
                const areaInfo = getObj.areaInfo
                if (!areaInfo) {
                    if (getObj.result !== undefined && err[getObj.result] === "NO_WORLDMAPOBJECT_FOUND") {
                        throw "NO_WORLDMAPOBJECT_FOUND"
                    }
                    throw "TIMED_OUT"
                }
                const level = areaInfo.extraData[4]

                const commanderStats = commander.getEffects(type)
                const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, commander, level, undefined, pluginOptions, commanderStats.additionalWaves)
                const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)
                const maxTroopFront = getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerBerimondTools = []
                const attackerWallBerimondTools = []
                const attackerGateBerimondTools = []
                const attackerShieldBerimondTools = []
                const attackerBannerKhanTools = []

                const attackerWallTools = []
                const attackerShieldTools = []

                const unitInv = castle.unitInventory ?? []
                for (let i = 0; i < unitInv.length; i++) {
                    const unit = unitInv[i]
                    if (unit.amount <= 0)
                        continue

                    if (unit.unitInfo.wodID == 277)
                        continue

                    if (unit.unitInfo.pointBonus != undefined) {
                        if (!unit.unitInfo.gateBonus && !unit.unitInfo.wallBonus && !unit.unitInfo.defRangeBonus) {
                            attackerBerimondTools.push(unit)
                        } else if (!pluginOptions.noEventTools) {
                            if (unit.unitInfo.gateBonus)
                                attackerGateBerimondTools.push(unit)
                            else if (unit.unitInfo.wallBonus)
                                attackerWallBerimondTools.push(unit)
                            else if (unit.unitInfo.defRangeBonus) {
                                if (pluginOptions.allowEventShields !== false)
                                    attackerShieldBerimondTools.push(unit)
                            }
                        }
                    }
                    else if (unit.unitInfo.pointBonus == undefined &&
                        unit.unitInfo.toolCategory &&
                        unit.unitInfo.usageEventID == undefined &&
                        unit.unitInfo.allowedToAttack == undefined &&
                        unit.unitInfo.typ == 'Attack' &&
                        unit.unitInfo.amountPerWave == undefined
                    ) {
                        if (unit.unitInfo.wallBonus)
                            attackerWallTools.push(unit)
                        else if (unit.unitInfo.defRangeBonus) {
                            const isWood = (unit.unitInfo.wodID == 620 || unit.unitInfo.comment2 == "Shields")
                            // الحديد: Premiumshields (cast iron mantlet -10%) + Eliteshields (shield wall -15%)
                            const isIron = (unit.unitInfo.wodID == 635 || unit.unitInfo.comment2 == "Premiumshields" || unit.unitInfo.comment2 == "Eliteshields")

                            if (isIron && pluginOptions.allowIronShields !== false) {
                                attackerShieldTools.push(unit)
                            } else if (isWood && pluginOptions.allowWoodShields !== false) {
                                attackerShieldTools.push(unit)
                            } else if (!isWood && !isIron) {
                                attackerShieldTools.push(unit)
                            }
                        }
                    }
                    else if (unit.unitInfo.fightType == 0 &&
                        isTroopResourceTypeAllowed(unit.unitInfo, pluginOptions)) {
                        if (pluginOptions.recruitBerimondUnits === false && unit.unitInfo.isAuxiliary)
                            continue
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

                const troopCountSetting = getBerimondTroopCountSetting()
                const targetMinTroopCount = pluginOptions.noEventChests ? troopCountSetting : minTroopCount
                const transferThreshold = pluginOptions.sendTroopsOver ? Number(pluginOptions.minTroopsTransferThreshold || 150) : targetMinTroopCount
                const chestTroopReserve = (!pluginOptions.noEventChests && attackerBerimondTools.length > 0) ?
                    2 + Math.max(0, attackInfo.A.length - 1) * 3 : 0
                const attackReadyTroopCount = troopCountSetting + chestTroopReserve

                // الهدف الحقيقي = سعة المعسكر الكاملة (maxAuxilariesTroops)
                const campCapacity = castle.getProductionData?.maxAuxilariesTroops ?? transferThreshold
                const troopFillTarget = pluginOptions.sendTroopsOver
                    ? Math.max(campCapacity, transferThreshold)
                    : transferThreshold

                const deficitThreshold = Math.max(minTroopCount, Number(pluginOptions.minTroopsTransferSize || 100))

                // إدارة وضع التعبئة
                if (pluginOptions.sendTroopsOver) {
                    const currentDeficit = Math.max(0, troopFillTarget - allTroopCount)

                    if (allTroopCount < transferThreshold || currentDeficit >= deficitThreshold) {
                        isFillingTroops = true
                    }
                    if (allTroopCount >= troopFillTarget || allTroopCount >= attackReadyTroopCount) {
                        isFillingTroops = false
                    }
                }

                if (allTroopCount < targetMinTroopCount || (pluginOptions.sendTroopsOver && isFillingTroops)) {
                    if (!pluginOptions.sendTroopsOver) {
                        if (allTroopCount < targetMinTroopCount)
                            throw "NO_MORE_TROOPS"
                    }
                    else {
                        // Check if there is already a troop transfer in transit!
                        if (castle.troopTransfer?.remainingTime > 0) {
                            try {
                                await skipResource(castle)
                            } catch (skipErr) {
                                console.debug("[بيريموند] تعذر تسريع نقل الجنود الموجود:", skipErr)
                            }
                            if (!(castle.troopTransfer?.remainingTime > 0)) {
                                await sendXT("dcl", JSON.stringify({ CD: 1 }))
                                await waitForResult("dcl", 1000 * 10)
                                return
                            }
                            const waitTime = Math.min(Math.ceil(castle.troopTransfer.remainingTime), 300)
                            console.info(`[بيريموند] هناك قوات في الطريق بالفعل. الانتظار ${waitTime} ثانية حتى وصولها...`)
                            await new Promise(resolve => setTimeout(resolve, waitTime * 1000).unref())
                            await sendXT("dcl", JSON.stringify({ CD: 1 }))
                            await waitForResult("dcl", 1000 * 10)
                            return
                        }

                        await sendXT("fuc", JSON.stringify({ CID: castle.id }))
                        let troopSendLimit = Number((await waitForResult("fuc", 1000 * 10))[0].FUC)
                        const neededTroops = Math.max(0, troopFillTarget - allTroopCount)
                        let troopSendLimitRemaining = Math.min(troopSendLimit, neededTroops)
                        if (troopSendLimitRemaining <= minTroopCount) {
                            // لا يمكن إرسال الكمية المتبقية (صغيرة جداً) - خروج من وضع التعبئة
                            isFillingTroops = false
                        }
                        if (troopSendLimitRemaining > minTroopCount) {
                            let prioritizedTroops = []
                            const allowedWods = []
                            if (pluginOptions.allowRelicShortbow) {
                                allowedWods.push(149, 2060, 2061, 2062, 2063, 2064, 2065, 2066, 2067, 2068, 2069)
                            }
                            if (pluginOptions.allowHorrificRangedVeteran) {
                                allowedWods.push(10, 410)
                            }
                            if (pluginOptions.allowHorrificRanged) {
                                allowedWods.push(715, 59)
                            }
                            if (pluginOptions.allowHorrificMeleeVeteran) {
                                allowedWods.push(9, 409)
                            }
                            if (pluginOptions.allowHorrificMelee) {
                                allowedWods.push(714, 58)
                            }
                            if (pluginOptions.allowNomadAttackerRange) {
                                allowedWods.push(6, 727)
                            }
                            if (pluginOptions.allowSamuraiAttackerRange) {
                                allowedWods.push(35)
                            }
                            if (pluginOptions.allowEliteheavycrossbowman) {
                                allowedWods.push(312, 2050, 2051, 2052, 2053, 2054, 2055, 2056, 2057, 2058, 2059)
                            }
                            if (pluginOptions.allowElitekingscrossbowman) {
                                allowedWods.push(76)
                            }
                            if (pluginOptions.allowElitelongbowman) {
                                allowedWods.push(311, 2040, 2041, 2042, 2043, 2044, 2045, 2046, 2047, 2048, 2049)
                            }

                            const hasSelections = (
                                pluginOptions.allowRelicShortbow ||
                                pluginOptions.allowEliteheavycrossbowman ||
                                pluginOptions.allowElitekingscrossbowman ||
                                pluginOptions.allowElitelongbowman ||
                                pluginOptions.allowHorrificRanged ||
                                pluginOptions.allowHorrificRangedVeteran ||
                                pluginOptions.allowHorrificMelee ||
                                pluginOptions.allowHorrificMeleeVeteran ||
                                pluginOptions.allowNomadAttackerRange ||
                                pluginOptions.allowSamuraiAttackerRange
                            )

                            if (hasSelections) {
                                for (const wod of [...new Set(allowedWods)]) {
                                    const mainUnitInv = mainCastle.unitInventory ?? []
                                    for (let i = 0; i < mainUnitInv.length; i++) {
                                        const unit = mainUnitInv[i]
                                        if (unit.amount <= 0 || troopBlackList.includes(unit.unitInfo.wodID))
                                            continue

                                        if (unit.unitInfo.wodID === wod) {
                                            if (unit.unitInfo.fightType == 0 &&
                                                isTroopResourceTypeAllowed(unit.unitInfo, pluginOptions)) {
                                                prioritizedTroops.push(unit)
                                            }
                                        }
                                    }
                                }
                            } else {
                                let attackerMeleeTroops = []
                                let attackerRangeTroops = []
                                const mainUnitInv = mainCastle.unitInventory ?? []
                                for (let i = 0; i < mainUnitInv.length; i++) {
                                    const unit = mainUnitInv[i]

                                    if (unit.amount <= 0)
                                        continue

                                    if (troopBlackList.includes(unit.unitInfo.wodID))
                                        continue

                                    if (unit.unitInfo.fightType == 0 &&
                                        isTroopResourceTypeAllowed(unit.unitInfo, pluginOptions)) {
                                        if (unit.unitInfo.role == "melee")
                                            attackerMeleeTroops.push(unit)
                                        else if (unit.unitInfo.role == "ranged")
                                            attackerRangeTroops.push(unit)
                                    }
                                }
                                orderTroopsByTypePreference(attackerMeleeTroops, pluginOptions)
                                orderTroopsByTypePreference(attackerRangeTroops, pluginOptions)
                                prioritizedTroops = [...attackerRangeTroops, ...attackerMeleeTroops]
                            }

                            let sendTroops = []
                            for (let i = 0; i < 10; i++) {
                                const unitSlot = [-1, 0]
                                troopSendLimitRemaining -= assignUnit(unitSlot, prioritizedTroops, troopSendLimitRemaining)

                                sendTroops.push(unitSlot)

                                if (troopSendLimitRemaining == 0)
                                    break
                            }
                            if (!sendTroops.every(e => e[0] == -1)) {
                                const totalAssignedToSend = sendTroops.reduce((sum, slot) => sum + (slot[0] !== -1 ? slot[1] : 0), 0)
                                if (totalAssignedToSend < deficitThreshold) {
                                    // تأجيل النقل لحين توفر المزيد من القوات
                                } else {
                                    let [, r] = await kingdomSendTroops(mainCastle, castle, sendTroops)
                                    if (r != 0) {
                                        if (r == 181) {
                                            console.info("[بيريموند] تم الوصول للحد الأقصى لحركات نقل الجنود بين الممالك (MAX_KINGDOM_ARMY_MOVEMENTS_EXCEEDED). الانتظار 3 دقائق لعودة أو وصول القوات...")
                                            await new Promise(resolve => setTimeout(resolve, 3 * 60 * 1000).unref())
                                        } else {
                                            console.info("[بيريموند] فشل إرسال الجنود من القلعة الرئيسية (كود الخطأ:", r, "). الانتظار 30 ثانية...")
                                            await new Promise(resolve => setTimeout(resolve, 30 * 1000).unref())
                                        }
                                        return
                                    }
                                    await skipResource(castle)

                                    console.log(troopSendLimit - troopSendLimitRemaining, "troopsMovedOver")
                                    return
                                }
                            }
                            await sendXT("dcl", JSON.stringify({ CD: 1 }))
                            await waitForResult("dcl", 1000 * 10)
                        }
                        if (allTroopCount < targetMinTroopCount) {
                            throw "NO_MORE_TROOPS"
                        }
                    }
                }

                attackerBerimondTools.sort((a, b) =>
                    Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))
                attackerGateBerimondTools.sort((a, b) =>
                    Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))
                attackerWallBerimondTools.sort((a, b) =>
                    Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))
                attackerShieldBerimondTools.sort((a, b) =>
                    Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))

                if (pluginOptions.lowValueChests) {
                    attackerBannerKhanTools.reverse()
                    attackerBerimondTools.reverse()
                    attackerGateBerimondTools.reverse()
                    attackerWallBerimondTools.reverse()
                    attackerShieldBerimondTools.reverse()
                }

                attackerWallTools.sort((a, b) =>
                    Number(a.unitInfo.wallBonus) - Number(b.unitInfo.wallBonus))

                // الترتيب تنازلي: الحديد الأقوى أولاً (shield wall=15, cast iron=10, خشب=5)
                attackerShieldTools.sort((a, b) =>
                    Number(b.unitInfo.defRangeBonus) - Number(a.unitInfo.defRangeBonus))

                attackerWallBerimondTools.push(...attackerWallTools)
                attackerShieldBerimondTools.push(...attackerShieldTools)
                let needWallTools = true
                let needShieldTools = true

                if (pluginOptions.noEventChests) {
                    needWallTools = Number(pluginOptions.wallTools || 0) > 0
                    needShieldTools = Number(pluginOptions.shieldTools || 0) > 0
                }

                const currentShieldsBought = loadShieldCounter(eventInfo)
                const shieldLimit = Number(pluginOptions.maxShieldBuyLimit || 20000)
                const canBuyMoreShields = currentShieldsBought < shieldLimit
                const buyAmount = Number(pluginOptions.buyAmount || 300)
                const buyThreshold = Number(pluginOptions.buyThreshold || 50)

                // احسب عدد الدروع الخشبية فقط لتحديد إن كان الشراء ضروري
                const woodShieldCount = attackerShieldBerimondTools.reduce((sum, u) =>
                    sum + ((u.unitInfo.wodID == 620 || u.unitInfo.comment2 === "Shields") ? Number(u.amount || 0) : 0), 0)
                const shieldsBelowThreshold = needShieldTools && woodShieldCount < buyThreshold

                if (pluginOptions.buyTools && pluginOptions.allowWoodShields !== false && shieldsBelowThreshold && canBuyMoreShields) {
                    const actualBuyAmount = Math.min(buyAmount, shieldLimit - currentShieldsBought)
                    try {
                        await setCastle(castle, async () => {
                            await sendXT("sbp", JSON.stringify({ PID: 36, BT: 0, TID: 27, AMT: actualBuyAmount, KID: 10, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 }))
                            const [, r] = await waitForResult("sbp", 1000 * 15, (obj, r) => {
                                if (r != 0)
                                    return true
                                if (obj.PID == 36 &&
                                    obj.AMT == actualBuyAmount)
                                    return true
                            })

                            if (r != 0) {
                                console.warn("[بيريموند] فشل شراء الدروع من السيرفر (كود الخطأ:", r, ") - سيتم إعادة المحاولة لاحقاً")
                                return
                            }
                            console.log(actualBuyAmount, "shieldsBrought")
                            attackerShieldBerimondTools.push({ amount: actualBuyAmount, unitInfo: { defRangeBonus: 1, wodID: 620 } })
                            saveShieldCounter(currentShieldsBought + actualBuyAmount, eventInfo)
                        })
                        await sendXT("dcl", JSON.stringify({ CD: 1 }))
                        await waitForResult("dcl", 1000 * 10)
                    } catch (buyErr) {
                        console.warn("[بيريموند] خطأ أثناء شراء الدروع:", buyErr, "- سيتم الانتظار 5 دقائق")
                    }
                }

                if (!pluginOptions.noEventTools && attackerShieldBerimondTools.length == 0) {
                    throw "NO_EVENT_SHIELDS_QUIT"
                }

                if (needShieldTools && attackerShieldBerimondTools.length == 0) {
                    throw "NO_SHIELDS_QUIT"
                }

                const checkIfNeeded = (unitSlot, tool, toolCount) => {
                    if (!tool[0]?.unitInfo?.pointBonus && !pluginOptions.noEventTools) {
                        return 0
                    }
                    return assignUnit(unitSlot, tool, toolCount)
                }

                const countAssignedTroops = slots =>
                    slots.reduce((sum, slot) => sum + (slot[0] !== -1 ? Number(slot[1] || 0) : 0), 0)

                const getTargetFlank = (wave, flankVal) => {
                    if (flankVal == "1") return { waveFlank: wave.R, flankIndex: 1 } // Right Flank
                    if (flankVal == "2") return { waveFlank: wave.M, flankIndex: 2 } // Front Flank (Middle)
                    return { waveFlank: wave.L, flankIndex: 0 } // Left Flank (default)
                }

                const chestToolsAvailable = !pluginOptions.noEventChests &&
                    attackerBerimondTools.length > 0 &&
                    !!attackerBerimondTools[0]?.unitInfo?.pointBonus

                const selectedFlankInfo = getTargetFlank(attackInfo.A[0], pluginOptions.attackFlank)
                const selectedFlankTroopCapacity = selectedFlankInfo.flankIndex === 2 ? maxTroopFront : maxTroopFlank
                const plannedMainTroops = Math.min(troopCountSetting, selectedFlankTroopCapacity)
                const plannedChestTroops = chestToolsAvailable ? 2 + Math.max(0, attackInfo.A.length - 1) * 3 : 0
                if (allTroopCount < plannedMainTroops + plannedChestTroops) {
                    throw "NO_MORE_TROOPS"
                }

                const flanks = [
                    { waveFlankKey: "L", flankIndex: 0 },
                    { waveFlankKey: "R", flankIndex: 1 },
                    { waveFlankKey: "M", flankIndex: 2 },
                ]

                const fillChestFlank = (wave, flankInfo) => {
                    const waveFlank = wave[flankInfo.waveFlankKey]
                    const maxTools = flankInfo.flankIndex === 2 ? getTotalAmountToolsFront(level) : getTotalAmountToolsFlank(level, 0)
                    const assignedTools = assignUnit(waveFlank.T[0], attackerBerimondTools, maxTools)
                    if (assignedTools <= 0)
                        return

                    assignUnit(
                        waveFlank.U[0],
                        attackerRangeTroops.length <= 0 ? attackerMeleeTroops : attackerRangeTroops,
                        1
                    )

                    if (countAssignedTroops(waveFlank.U) <= 0) {
                        waveFlank.T.forEach(slot => {
                            slot[0] = -1
                            slot[1] = 0
                        })
                    }
                }

                attackInfo.A.forEach((wave, index) => {
                    const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                    const maxToolsFront = getTotalAmountToolsFront(level)

                    const targetFlankInfo = getTargetFlank(wave, pluginOptions.attackFlank)
                    const waveFlank = targetFlankInfo.waveFlank
                    const flankIndex = targetFlankInfo.flankIndex

                    let maxTools = flankIndex === 2 ? maxToolsFront : maxToolsFlank

                    if (index == 0) {
                        waveFlank.T.forEach((unitSlot, i) => {
                            let toolArray = []
                            let userLimit = 0

                            if (flankIndex === 2) {
                                // Front Flank: i == 0 -> Wall, i == 1 -> Gate, i == 2 -> Shield
                                if (i === 0) {
                                    toolArray = attackerWallBerimondTools
                                    userLimit = Number(pluginOptions.wallTools || 0)
                                } else if (i === 1) {
                                    toolArray = attackerGateBerimondTools
                                    userLimit = Number(pluginOptions.gateTools || 0)
                                } else if (i === 2) {
                                    toolArray = attackerShieldBerimondTools
                                    userLimit = Number(pluginOptions.shieldTools || 0)
                                }
                            } else {
                                // Left/Right Flank: i == 0 -> Wall, i == 1 -> Shield
                                if (i === 0) {
                                    toolArray = attackerWallBerimondTools
                                    userLimit = Number(pluginOptions.wallTools || 0)
                                } else if (i === 1) {
                                    toolArray = attackerShieldBerimondTools
                                    userLimit = Number(pluginOptions.shieldTools || 0)
                                }
                            }

                            const toolCount = Math.min(maxTools, userLimit)
                            maxTools -= checkIfNeeded(unitSlot, toolArray, toolCount)
                        })

                        let maxTroops = Math.min(troopCountSetting, flankIndex === 2 ? maxTroopFront : maxTroopFlank)
                        waveFlank.U.forEach((unitSlot) => {
                            maxTroops -= assignUnit(
                                unitSlot,
                                attackerRangeTroops.length <= 0 ? attackerMeleeTroops : attackerRangeTroops,
                                maxTroops
                            )
                        })
                    }
                    if (chestToolsAvailable) {
                        const mainFlankKey = flankIndex === 2 ? "M" : flankIndex === 1 ? "R" : "L"
                        const chestFlanks = index === 0 ?
                            flanks.filter(info => info.waveFlankKey !== mainFlankKey) :
                            flanks

                        for (const chestFlank of chestFlanks) {
                            fillChestFlank(wave, chestFlank)
                        }
                    }
                })

                const firstWaveInfo = getTargetFlank(attackInfo.A[0], pluginOptions.attackFlank)
                if (countAssignedTroops(firstWaveInfo.waveFlank.U) <= 0) {
                    throw "NO_MORE_TROOPS"
                }

                await sendXT("cra", JSON.stringify(attackInfo))

                let [obj, result] = await waitForResult("cra", 1000 * 10, (obj, result) => {
                    if (result != 0)
                        return true

                    if (obj.AAM.M.KID != kingdomID || obj.AAM.M.TA[0] != type)
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
                    console.log("Waiting for troops")
                    let timer
                    await new Promise(resolve => {
                        function self(movement) {
                            if (movement.kingdomID != kingdomID)
                                return

                            cleanup()
                            resolve()
                        }
                        function timeout() {
                            cleanup()
                            resolve()
                        }
                        function cleanup() {
                            movementEvents.off("return", self)
                            clearTimeout(timer)
                        }
                        movementEvents.on("return", self)
                        timer = setTimeout(timeout, 1000 * 30).unref()
                    })
                    await sendXT("dcl", JSON.stringify({ CD: 1 }))
                    await waitForResult("dcl", 1000 * 10)
                    break
                case "NO_MORE_TOOLS":
                    console.log("Waiting for tools")
                    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000).unref())
                    break
                case "NO_SHIELDS_QUIT":
                    console.error("[بيريموند] تم إيقاف البوت: نفاد الدروع بالكامل وتعذر الشراء (إما لتخطي حد الشراء أو لنقص العملات أو لإلغاء خيار الشراء تلقائياً)!")
                    quit = true
                    break
                case "NO_EVENT_SHIELDS_QUIT":
                    console.error("[بيريموند] تم إيقاف البوت إجبارياً: نفاد دروع الحدث بالكامل (Event Shields) وتفعيل خيار الهجوم بأدوات الحدث!")
                    quit = true
                    break
                case "NO_WORLDMAPOBJECT_FOUND":
                    console.log("[بيريموند] لم يتم العثور على أهداف (NO_WORLDMAPOBJECT_FOUND). الانتظار لمدة 5 دقائق...")
                    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000).unref())
                    break
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                // falls through
                case "ATTACK_TOO_MANY_UNITS":
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "MISSING_UNITS":
                    if (e === "MISSING_UNITS") {
                        console.log("Waiting for troops")
                        try {
                            await sendXT("dcl", JSON.stringify({ CD: 1 }))
                            await waitForResult("dcl", 1000 * 10)
                        } catch (refreshError) {
                            console.debug("berimondRefreshAfterMissingUnitsFailed:", refreshError)
                        }
                        await new Promise(resolve => setTimeout(resolve, 30 * 1000).unref())
                    }
                // falls through
                case "NOT_ENOUGH_CURRENCY1":
                    console.debug("attackBerimondKingdom retryable:", e)
                    break
                case "CANT_START_NEW_ARMIES": {
                    // All commander slots full — wait until one attack returns before retrying
                    console.log("[بيريموند] كل خانات القائد ممتلئة، انتظار عودة هجوم...")
                    let timer
                    await new Promise(resolve => {
                        function onReturn(movement) {
                            if (movement.kingdomID !== kingdomID)
                                return
                            cleanup()
                            resolve()
                        }
                        function timeout() {
                            cleanup()
                            resolve()
                        }
                        function cleanup() {
                            movementEvents.off("return", onReturn)
                            clearTimeout(timer)
                        }
                        movementEvents.on("return", onReturn)
                        timer = setTimeout(timeout, 1000 * 60 * 3).unref()
                    })
                    break
                }
                default:
                    console.error(e)
                    quit = true
            }
        }
    }
})
