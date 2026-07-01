if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden: true }

const buildings = require("../items/buildings.json")
const { waitForResult, sendXT, botConfig } = require("../ggeBot")
const { resources } = require("../protocols")
const { MinuteSkipType, spendSkip } = require("../addons/skips")

function costTable(castle) {
    return [
        [!botConfig.externalEvent ? "costWood" : "tempServerCostWood", "wood", castle],
        [!botConfig.externalEvent ? "costStone" : "tempServerCostStone", "stone", castle],
        ["costAquamarine", "aqua", castle],
        ["costGlass", "glass", castle],
        ["costIron", "iron", castle],
        ["costOil", "oil", castle],
        ["costCoal", "coal", castle],
        ["costLegendaryToken", "legendaryToken", resources],
        ["costLegendaryMaterial", "legendaryMaterial", resources],
        ["costPlaster", "plaster", resources],
        ["costDragonScaleTile", "dragonScaleTile", resources],
        ["costC2", "rubies", resources],
        ["costC1", "coins", resources],
        ["costImperialDucat", "imperialDucat", resources],
        ["costGoldToken", "goldToken", resources],
        ["costFloraToken", "floraToken", resources],
        ["costCommonStraw", "CommonStraw", resources],
        ["costSceatToken", "SceatToken", resources],
        ["costRareNails", "RareNails", resources],
        ["costRareGlue", "RareGlue", resources]
    ]
}

function hasFreeConstructionSlot(castle) {
    return castle.buildingSlots?.some(e => e == -1) ?? false
}

function canAffordBuilding(castle, buildingInfo) {
    return costTable(castle).every(([costObject, resourceKey, resourceHolder]) => {
        const cost = Number(buildingInfo[costObject] ?? 0)
        if (cost <= 0) return true
        const available = resourceHolder[resourceKey] ?? 0
        return cost <= available
    })
}

function deductBuildingCosts(castle, buildingInfo) {
    costTable(castle).forEach(([costObject, resourceKey, resourceHolder]) => {
        const cost = Number(buildingInfo[costObject] ?? 0)
        if (cost > 0 && typeof resourceHolder[resourceKey] === 'number') {
            resourceHolder[resourceKey] -= cost
        }
    })
}

function getBuildingsByGroup(castle, wodID) {
    const list = []

    for (let start = wodID; true;) {
        let item = buildings.find(building => building.wodID == start)
        if (!item.upgradeWodID)
            break

        list.push(item.wodID)

        if (start == item.upgradeWodID)
            throw new Error("RECURSION")

        start = item.upgradeWodID
    }

    return castle.buildings.reduce((accumulator, object) => {
        let building = buildings.find(e => e?.wodID == list.find(wodID => wodID == object.wodID))
        if (building)
            accumulator.push({ building, ownerID: object.ownerID })
        return accumulator
    }, [])
}

/**
 * @param {Number} ownerID
 */
async function skipConstructionTime(castle, ownerID, customPluginOptions) {
    const building = castle.buildings.find(e => e.ownerID == ownerID)
    if (!building)
        throw new Error("BUILDING_NOT_FOUND")

    let buildingInfo = buildings.find(e => e?.wodID == building.wodID)
    if (buildingInfo == undefined)
        throw new Error("BUILDING_INFO_NOT_FOUND")

    let timeToSkip = Number(buildingInfo.buildDuration) / building.constructionBoost - building.buildTime

    do {
        if (timeToSkip <= 4 * 60) {
            await sendXT("fco", JSON.stringify({ OID: ownerID, FS: 1 }))
            await waitForResult("fco", 1000 * 10, (obj, r) => {
                return r != 0 || obj?.O[1] == ownerID
            })
            break
        }

        const skip = spendSkip(timeToSkip - 4 * 60, customPluginOptions)
        if (!skip)
            throw new Error("FAILED_TO_SKIP")

        await sendXT("msb", JSON.stringify({ OID: ownerID, MST: skip }))
        await waitForResult("msb", (obj, result) => {
            if (result != 0)
                return true

            if (obj.scl?.OIDL?.find(e => e == ownerID))
                return true

            return false
        })
        timeToSkip -= MinuteSkipType[skip] * 60
    } while (timeToSkip > 0)

    const [egoObj, egoRes] = await waitForResult("ego", 1000 * 10, obj => obj?.O[1] == ownerID)

    if (castle.buildingSlots) {
        const slotIdx = castle.buildingSlots.indexOf(ownerID)
        if (slotIdx !== -1) {
            castle.buildingSlots[slotIdx] = -1
        }
    }

    return [egoObj, egoRes]
}

async function finishConstructionQueue(castle, customPluginOptions) {
    if (!castle.buildingSlots)
        return false

    let progressed = false
    for (let i = 0; i < castle.buildingSlots.length; i++) {
        const ownerID = castle.buildingSlots[i]
        if (ownerID < 0)
            continue

        try {
            await skipConstructionTime(castle, ownerID, customPluginOptions)
            castle.buildingSlots[i] = -1
            progressed = true
        } catch (e) {
            console.debug("finishConstructionQueue:", e.message)
            break
        }
    }
    return progressed
}

/**
 * @param {Number} ownerID
 */
async function upgradeBuilding(castle, ownerID, customPluginOptions) {
    if (!hasFreeConstructionSlot(castle))
        throw new Error("NO_FREE_CONSTRUCTION_SLOTS")

    let currentBuilding = castle.buildings?.find(e => e.ownerID == ownerID)
    if (currentBuilding == undefined)
        throw new Error("BUILDING_NOT_FOUND")

    let buildingInfo = buildings.find(e => e?.wodID == currentBuilding.wodID)
    if (buildingInfo == undefined)
        throw new Error("BUILDING_INFO_NOT_FOUND")

    if (!buildingInfo.upgradeWodID)
        throw new Error("BUILDING_FULLY_UPGRADED")

    let newBuildingInfo = buildings.find(e => e?.wodID == buildingInfo.upgradeWodID)

    if (!canAffordBuilding(castle, newBuildingInfo))
        throw new Error("NOT_ENOUGH_RESOURCE")

    await sendXT("eup", JSON.stringify({ OID: ownerID, PWR: 0, PO: -1 }))
    let [obj] = await waitForResult("eup", 1000 * 10, obj => {
        return obj?.O?.find(e => e[1] == ownerID)
    })

    // Mark the slot as busy locally
    if (castle.buildingSlots) {
        const freeIdx = castle.buildingSlots.indexOf(-1)
        if (freeIdx !== -1) {
            castle.buildingSlots[freeIdx] = ownerID
        }
    }

    let timeToSkip = Number(newBuildingInfo.buildDuration) / castle.getProductionData.buildSpeedBoost - obj.O[0][5]

    do {
        if (timeToSkip <= 4 * 60) {
            await sendXT("fco", JSON.stringify({ OID: ownerID, FS: 1 }))
            await waitForResult("fco", 1000 * 10, (obj, r) => {
                return r != 0 || obj?.O[1] == ownerID
            })
            break
        }

        const skip = spendSkip(timeToSkip - 4 * 60, customPluginOptions)
        if (!skip)
            throw new Error("FAILED_TO_SKIP")

        await sendXT("msb", JSON.stringify({ OID: ownerID, MST: skip }))
        await waitForResult("msb", (obj, result) => {
            if (result != 0)
                return true

            if (obj.scl?.OIDL?.find(e => e == ownerID))
                return true

            return false
        })
        timeToSkip -= MinuteSkipType[skip] * 60
    } while (timeToSkip > 0)

    deductBuildingCosts(castle, newBuildingInfo)

    const [egoObj, egoRes] = await waitForResult("ego", 1000 * 10, obj => {
        return obj?.O[1] == ownerID
    })

    // Set the slot back to -1 locally since it is now completed
    if (castle.buildingSlots) {
        const slotIdx = castle.buildingSlots.indexOf(ownerID)
        if (slotIdx !== -1) {
            castle.buildingSlots[slotIdx] = -1
        }
    }

    return [egoObj, egoRes]
}

const PLACE_SKIP_POSITION_ERRORS = new Set([6, 52, 55, 63])

async function placeBuilding(castle, wodID, maxPO = 512) {
    if (!hasFreeConstructionSlot(castle))
        throw new Error("NO_FREE_CONSTRUCTION_SLOTS")

    const buildingInfo = buildings.find(e => e?.wodID == wodID)
    if (!buildingInfo)
        throw new Error("BUILDING_INFO_NOT_FOUND")

    if (!canAffordBuilding(castle, buildingInfo))
        throw new Error("NOT_ENOUGH_RESOURCE")

    for (let po = 0; po < maxPO; po++) {
        await sendXT("eup", JSON.stringify({ WID: wodID, PO: po, PWR: 0, BA: 0 }))
        const [obj, result] = await waitForResult("eup", 1000 * 10, obj => obj?.O?.length > 0)

        if (result != 0) {
            if (PLACE_SKIP_POSITION_ERRORS.has(result))
                continue
            throw new Error(`PLACE_BUILDING_FAILED_${result}`)
        }

        const buildingRow = obj.O.find(e => Number(e[0]) == wodID) ?? obj.O[0]
        const ownerID = Number(buildingRow[1])

        let timeToSkip = Number(buildingInfo.buildDuration) / castle.getProductionData.buildSpeedBoost - Number(buildingRow[5])

        do {
            if (timeToSkip <= 4 * 60) {
                await sendXT("fco", JSON.stringify({ OID: ownerID, FS: 1 }))
                await waitForResult("fco", 1000 * 10, (obj, r) => {
                    return r != 0 || obj?.O[1] == ownerID
                })
                break
            }

            const skip = spendSkip(timeToSkip - 4 * 60)
            if (!skip)
                throw new Error("FAILED_TO_SKIP")

            await sendXT("msb", JSON.stringify({ OID: ownerID, MST: skip }))
            await waitForResult("msb", (obj, result) => {
                if (result != 0)
                    return true

                if (obj.scl?.OIDL?.find(e => e == ownerID))
                    return true

                return false
            })
            timeToSkip -= MinuteSkipType[skip] * 60
        } while (timeToSkip > 0)

        deductBuildingCosts(castle, buildingInfo)
        await waitForResult("ego", 1000 * 10, obj => obj?.O[1] == ownerID)
        return ownerID
    }

    throw new Error("NO_VALID_POSITION")
}

async function expandCastle(castle) {
    if (castle.expandFailed)
        return false
    if (!hasFreeConstructionSlot(castle))
        return false

    try {
        await sendXT("ceu", JSON.stringify({ KID: castle.kingdomID, CID: castle.id, PWR: 0, PO: -1 }))
        const [, result] = await waitForResult("ceu", 1000 * 10)

        if (result != 0) {
            castle.expandFailed = true
            return false
        }

        console.log("expandedStormCastle")
        return true
    } catch (e) {
        castle.expandFailed = true
        throw e
    }
}

/** @deprecated use skipConstructionTime */
const skipBuilding = skipConstructionTime

module.exports = {
    upgradeBuilding,
    skipBuilding,
    skipConstructionTime,
    finishConstructionQueue,
    placeBuilding,
    expandCastle,
    costTable,
    canAffordBuilding,
    hasFreeConstructionSlot,
    getBuildingsByGroup
}
