if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "minCastleTroopCount",
                default: "1000"
            },
            {
                type: "Text",
                key: "minHitTroopCount",
                default: "1000"
            },
            {
                type: "Text",
                key: "coordsEmpire"
            },
            {
                type: "Text",
                key: "coordsGlacier"
            },
            {
                type: "Text",
                key: "coordsSands"
            },
            {
                type: "Text",
                key: "coordsPeaks"
            },
            {
                type: "Text",
                key: "coordsStorm"
            },
            {
                type: "Text",
                key: "stationTime",
                default: "12"
            },
            {
                type: "Text",
                key: "minTroopSendCount",
                default: "0"
            },
            {
                type: "Text",
                key: "commanderWhiteList",
                default: "1-99"
            },
        ]
    }

const { botConfig, sendXT, waitForResult, playerInfo } = require('../ggeBot.js')
const { ClientCommands, KingdomID, AreaType, movementEvents, castles } = require('../protocols')
const { waitForCommanderAvailable } = require('../addons/commander')
const units = require('../items/units.json')

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

function parseCoords(str) {
    if (!str) return null
    const match = str.match(/(\d+)\s*[:,\s]\s*(\d+)/)
    if (match) {
        return { x: parseInt(match[1]), y: parseInt(match[2]) }
    }
    return null
}

movementEvents.on("outgoing", async (/** @type {import("../protocols.js").ClassTypes.Movement} */ movement) => {
    if (![0, 25, 31, 24, 29].includes(movement.type))
        return
    if (movement.targetOwner?.ownerID != playerInfo.playerID)
        return
    if (movement.targetOwner.remainingPeaceTime > 0)
        return console.info("notFleeing", "underBird")
    if (movement.targetOwner.remainingNoobTime > 0)
        return console.info("notFleeing", "noobProtection")
    if (!movement.canSeeArmy)
        return console.info("notFleeing", "cantSeeArmy")

    let unitCount = 0
    movement.left.forEach(e => unitCount += e.amount)
    movement.right.forEach(e => unitCount += e.amount)
    movement.middle.forEach(e => unitCount += e.amount)
    movement.courtyard.forEach(e => unitCount += e.amount)

    if (unitCount < parseInt(pluginOptions.minHitTroopCount))
        return console.info("notFleeing", "troopCountTooSmall")

    let castle = castles.find(a => a.kingdomID == movement.kingdomID && a.id == movement.targetAttack.extraData[0])
    unitCount = 0
    ;(castle.unitInventory ?? []).forEach(e => unitCount += e.amount)

    if (unitCount < parseInt(pluginOptions.minCastleTroopCount))
        return console.info("notFleeing", "tooLittleTroopsInCastle")

    let coordStr = ""
    if (movement.kingdomID === 0) {
        coordStr = pluginOptions.coordsEmpire
    } else if (movement.kingdomID === 2) {
        coordStr = pluginOptions.coordsGlacier
    } else if (movement.kingdomID === 3) {
        coordStr = pluginOptions.coordsSands
    } else if (movement.kingdomID === 4) {
        coordStr = pluginOptions.coordsPeaks
    } else if (movement.kingdomID === 1) {
        coordStr = pluginOptions.coordsStorm
    }

    const targetCoords = parseCoords(coordStr)
    if (!targetCoords)
        return console.warn("noValidCoordsConfiguredForKingdom", KingdomID[movement.kingdomID] ?? movement.kingdomID)

    let targetArea = { x: targetCoords.x, y: targetCoords.y }
    const MAX_RETRIES = 3
    const RETRY_DELAY_MS = 2000

    function getAvailableTroops() {
        const unitInv = castle.unitInventory ?? []
        const result = []
        for (let i = 0; i < unitInv.length; i++) {
            const unit = unitInv[i]
            if (unit.amount <= 0) continue
            if (unit.unitInfo && unit.unitInfo.role) {
                if (unit.amount >= parseInt(pluginOptions.minTroopSendCount || "0"))
                    result.push([unit.unitInfo.wodID, unit.amount])
            }
        }
        return result
    }

    await sendXT("dcl", JSON.stringify({ CD: 1 }))
    await waitForResult("dcl", 1000 * 10)

    const chunkSize = 10
    let retryCount = 0

    while (true) {
        const troops = getAvailableTroops()

        if (troops.length === 0) {
            console.info("troopsMovedOver", "0")
            break
        }

        let success = true

        for (let i = 0; i < troops.length; i += chunkSize) {
            const chunk = troops.slice(i, i + chunkSize)

            let lord = await waitForCommanderAvailable(pluginOptions.commanderWhiteList)

            console.log("tryingToSend", `${movement.targetAttack.x}:${movement.targetAttack.y}`, "tryingToSendTo",
                `${targetArea.x}:${targetArea.y} ${KingdomID[movement.kingdomID] ?? movement.kingdomID}`)

            console.debug(`${JSON.stringify({
                SID: castle.id,
                TX: targetArea.x,
                TY: targetArea.y,
                LID: lord.lordID,
                WT: parseInt(pluginOptions.stationTime || "12"),
                HBW: -1,
                BPC: 0,
                PTT: 0,
                SD: 0,
                A: chunk
            })}`)

            await sendXT("cds", JSON.stringify({
                SID: castle.id,
                TX: targetArea.x,
                TY: targetArea.y,
                LID: lord.lordID,
                WT: parseInt(pluginOptions.stationTime || "12"),
                HBW: -1,
                BPC: 0,
                PTT: 0,
                SD: 0,
                A: chunk
            }))

            const [, result] = await waitForResult("cds", 1000 * 10)

            if (result !== 0) {
                console.warn("failedToSendTroopsOver", `cds error result: ${result}`)
                success = false
                break
            }
        }

        if (success) break

        retryCount++
        if (retryCount >= MAX_RETRIES) {
            console.warn("failedToSendTroopsOver", `max retries (${MAX_RETRIES}) reached`)
            break
        }

        const remaining = getAvailableTroops()
        console.warn("failedToSendTroopsOver",
            `retry ${retryCount}/${MAX_RETRIES} - ${remaining.reduce((s, t) => s + t[1], 0)} troops remaining`)
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    }
})