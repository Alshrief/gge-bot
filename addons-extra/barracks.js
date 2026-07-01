if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "level",
            },
            {
                type: "Select",
                key: "troopType",
                selection: [
                    "Range Mead Att",
                    "Range Mead Def",
                    "Melee Mead Att",
                    "Melee Mead Def",
                    "Relic Shortbow",
                    "Relic Axeman",
                    "Spearman"
                ],
                default: "0"
            },
            {
                type: "Checkbox",
                key: "randomizeTiming",
                default: false
            },
        ]
    };
const { botConfig, xtHandler } = require("../ggeBot.js")
const {
    KingdomID,
    castles,
    setCastle
} = require("../protocols.js")
const { sendXT, waitForResult, events } = require("../ggeBot.js")
const units = require("../items/units.json")
const buildings = require("../items/buildings.json")

const effectTypes = require("../items/effecttypes.json")
const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const sceatSkills = require("../items/sceatSkills.json")

let selectedTroop = [
    205,
    228,
    195,
    217,
    149,
    148,
    602,
][pluginOptions.troopType]
//SKL
let foundAll = false
let list = []
let start = 160
while (!foundAll) {
    let item = buildings.find(e => e?.wodID == start)
    list.push(item.wodID)
    if (!item.upgradeWodID)
        foundAll = true
    if (start == item.upgradeWodID)
        throw Error("Recursion")
    start = item.upgradeWodID
}
let skl
xtHandler.on("skl", e => skl = e)
let activeEffects = {}
let ungroupedActiveEffects = {}
events.once("load", async () => {
    // ungroupedActiveEffects = {}
    // skl.SIDS.forEach(skillID => {
    //     const sceatSkill = sceatSkills.find(e => e.skillID == skillID)
    //     if (!sceatSkill)
    //         return
    //     const [effectID, value] = sceatSkill.effects.split('&')

    //     ungroupedActiveEffects[effectID] ??= []
    //     ungroupedActiveEffects[effectID] = value.split(',')
    // })
    // activeEffects = {}
    // for (const key in ungroupedActiveEffects) {
    //     let effectTypeID = effects.find(e => e.effectID == key).effectTypeID
    //     let effectType = effectTypes.find(e => e.effectTypeID == effectTypeID)
    //     activeEffects[effectType.name] = ungroupedActiveEffects[key] 
    // }

    if (String(pluginOptions.level) == "")
        return console.warn("barracksLevelNotDefined")

    let recruitTroops = (castle, index) => setCastle(castle, async () => {
        index ??= 0
        index++
        await sendXT("jca", JSON.stringify({ CID: castle.id, KID: castle.kingdomID }))
        let [obj, _] = await waitForResult("jaa", 1000 * 10, o => o.grc.KID == castle.kingdomID && o.grc.AID == castle.id)

        const buildingObject = obj.gca.BD.find(e => list.includes(e[0]))
        const wodID = buildingObject[0]

        if (!wodID)
            return 0

        await sendXT("spl", JSON.stringify({ LID: 0 }))
        const obj2 = (await waitForResult("spl", 1000 * 10))[0]
        let troopsRecruited = 0

        for (let i = 0; i < obj2.QS.length; i++) {
            const obj4 = obj2.QS[i]

            if (obj4.P)
                continue
            if (obj4.SI.RUT == 0)
                continue

            let foundAll = false
            let list = []
            let start = selectedTroop
            let level = pluginOptions.level

            if ([, ''].includes(level))
                return 0

            while (!foundAll) {
                let item = units.find(e => e?.wodID == start)
                list.push(item.wodID)
                if (!item.upgradeWodID)
                    foundAll = true
                if (start == item.upgradeWodID)
                    throw Error("Recursion")
                start = item.upgradeWodID
            }
            switch (selectedTroop) {
                case 228:
                    list.push(493)
                    break
                case 217:
                    list.push(489)
            }

            let stackSize = Number(buildings.find(e => e?.wodID == wodID)?.stackSize)

            // const unlockedIDs = Array.from(buildings[wodID].unlockIDs).split(',').map(Number)

            let buildingUniqueID = buildingObject[1]
            let builditems = obj.gca.CI.find(e => e.OID == buildingUniqueID)
            if (builditems?.CIL.find(e => e.CID == 14))
                stackSize += 80

            if (stackSize <= 0) {
                console.log("couldNotRecruitReason", "couldNotRecruitReasonTroopLimitReached")
                setTimeout(recruitTroops, 60 * 5 * 1000, castle)
                return 0;
            }

            await sendXT("bup", JSON.stringify({
                LID: 0,
                WID: list[Number(level)],
                AMT: stackSize,
                PO: -1,
                PWR: 0,
                SK: 73,
                SID: 2,
                AID: castle.id
            }))

            if ((await waitForResult("bup", 1000 * 10))[1] != 0) {
                console.warn("failedToRecruitTroops", `KID:${castle.kingdomID} AID:${castle.id}`)
                return 0
            }

            troopsRecruited += stackSize
        }
        // if(!obj2.QS.every(e => e.P?.RAH == undefined || e.P.RAH == true)) {
        sendXT("ahr", JSON.stringify({ ID: 0, T: 6 }))
        // }
        await sendXT("spl", JSON.stringify({ LID: 0 }))
        setTimeout(recruitTroops, (await waitForResult("spl", 1000 * 10))[0].TCT * 1000, castle)

        return troopsRecruited
    })

    let troopsRecruited = 0
    for (let i = 0; i < castles.length; i++) {
        const castle = castles[i]

        if ([KingdomID.stormIslands, KingdomID.berimond].includes(castle.kingdomID))
            continue

        try {
            if (pluginOptions.randomizeTiming) {
                const randomIntFromInterval = (min, max) =>
                    Math.floor(Math.random() * (max - min + 1) + min)

                await new Promise(r => setTimeout(r, randomIntFromInterval(3 * i, 2.5 * i) * 1000))
            }
            troopsRecruited += await recruitTroops(castle, i)
        }
        catch (e) {
            console.warn(e)
        }
    }
    console.log(troopsRecruited, "recruitedTroops")
})