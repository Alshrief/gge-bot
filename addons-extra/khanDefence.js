if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden: false }

const { xtHandler, events, sendXT, waitForResult } = require('../ggeBot')
const { ClassTypes: { GAAAreaInfo, Lord, UnitInventory, Unit }, KingdomID, AreaType, castles } = require("../protocols")
const { assignUnit } = require('../addons/attack/attack')

class DefenceView {
    constructor(obj) {
        this.areaInfo = new GAAAreaInfo(obj.A)

        this.wallTools = {
            left: {
                slot: Array.from(obj.dfw.L.S).map(Unit),
                unitPercentage: Number(obj.dfw.L.UP),
                unitComposition: Number(obj.dfw.L.UC)
            },
            right: {
                slot: Array.from(obj.dfw.R.S).map(Unit),
                unitPercentage: Number(obj.dfw.R.UP),
                unitComposition: Number(obj.dfw.R.UC)
            },
            middle: {
                slot: Array.from(obj.dfw.M.S).map(Unit),
                unitPercentage: Number(obj.dfw.M.UP),
                unitComposition: Number(obj.dfw.M.UC)
            },
        }
        this.keepTools = {
            spaceInKeepSlot: Array.from(obj.dfk.S).map(Unit),
            supportTools: Array.from(obj.dfk.STS).map(Unit),
            unitComposition: Number(obj.dfk.UC)
        }
        this.moatTools = {
            left: Unit(obj.dfm.LS[0], obj.dfm.LS[1]),
            right: Unit(obj.dfm.RS[0], obj.dfm.RS[1]),
            middle: Unit(obj.dfm.MS[0], obj.dfm.MS[1])
        }
        this.lord = new Lord(obj.L)
        this.inventory = new UnitInventory(obj.gui)
        const applyDefenseToUnitInventory = unit => {
            if (!unit.unitInfo)
                return
            const inventoryUnitInfo = this.inventory.unitInventory.find(a => a.unitInfo.wodID == unit.unitInfo.wodID)
            if (inventoryUnitInfo)
                inventoryUnitInfo.amount += unit.amount
            else
                this.inventory.unitInventory.push(unit)
        }
        applyDefenseToUnitInventory(this.moatTools.left)
        applyDefenseToUnitInventory(this.moatTools.right)
        applyDefenseToUnitInventory(this.moatTools.middle)
        this.wallTools.left.slot.forEach(applyDefenseToUnitInventory)
        this.wallTools.right.slot.forEach(applyDefenseToUnitInventory)
        this.wallTools.middle.slot.forEach(applyDefenseToUnitInventory)
        this.keepTools.spaceInKeepSlot.forEach(applyDefenseToUnitInventory)
        this.keepTools.supportTools.forEach(applyDefenseToUnitInventory)
        this.toolTriggerLimit = Number(obj.dfk.MAUCT)
    }
}

const kingdomID = KingdomID.greatEmpire

async function setupDefencesForKhan() {
    const castle = castles.find(e => e.kingdomID == kingdomID && e.areaInfo.type == AreaType.mainCastle)

    await sendXT("dfc", JSON.stringify({ CX: castle.areaInfo.x, CY: castle.areaInfo.y, AID: castle.id, KID: kingdomID }))

    const defenceView = new DefenceView((await waitForResult("dfc", 1000 * 10, obj => {
        const { x, y, extraData } = new GAAAreaInfo(obj.A)
        return castle.areaInfo.x == x && castle.areaInfo.y == y &&
            castle.id == extraData[0]
    }))[0])

    let tools = defenceView.inventory.unitInventory.filter(unit =>
        unit.unitInfo.typ == "Defence")
        .sort((a, b) => (b.unitInfo.gateBonus ?? 0) - (a.unitInfo.gateBonus ?? 0))
        .sort((a, b) => (b.unitInfo.wallBonus ?? 0) - (a.unitInfo.wallBonus ?? 0))
        .sort((a, b) => (b.unitInfo.defRangeBonus ?? 0) - (a.unitInfo.defRangeBonus ?? 0))
        .sort((a, b) => (b.unitInfo.moatBonus ?? 0) - (a.unitInfo.moatBonus ?? 0))
        .sort((a, b) => (b.unitInfo.khanMedalBooster ?? 0) - (a.unitInfo.khanMedalBooster ?? 0))

    const gateTools = tools.filter(e => e.unitInfo.slotTypes.split(',').find(e => e == 2))
    const wallTools = tools.filter(e => e.unitInfo.slotTypes.split(',').find(e => e == 1))
    const moatTools = tools.filter(e => e.unitInfo.slotTypes.split(',').find(e => e == 4))
    const keepTools = tools.filter(e => e.unitInfo.slotTypes.split(',').find(e => e == 5))
        .filter(e => e.unitInfo.khanMedalBooster != undefined)

    const moatleftSide = [-1, 0]
    assignUnit(moatleftSide, moatTools, 999)
    const moatRightSide = [-1, 0]
    assignUnit(moatRightSide, moatTools, 999)
    const moatMiddleSide = [-1, 0]
    assignUnit(moatMiddleSide, moatTools, 999)

    sendXT("dfm", JSON.stringify({
        CX: castle.areaInfo.x,
        CY: castle.areaInfo.y,
        AID: castle.id,
        LS: [moatleftSide],
        MS: [moatMiddleSide],
        RS: [moatRightSide]
    }))
    const spaceInKeep = []

    for (let i = 0; i < 3; i++) {
        const unitSlot = [-1, 0]
        assignUnit(unitSlot, keepTools, Math.ceil((keepTools[0]?.amount ?? 999) / 3))
        spaceInKeep.push(unitSlot)
    }
    sendXT("dfk", JSON.stringify({
        CX: castle.areaInfo.x,
        CY: castle.areaInfo.y,
        AID: castle.id,
        MAUCT: defenceView.toolTriggerLimit,
        UC: defenceView.keepTools.unitComposition,
        S: spaceInKeep,
        STS: [[-1, 0], [-1, 0], [-1, 0]]
    }))

    const wallLeft = []
    const wallRight = []
    const wallMiddle = []

    for (let i = 0; i < 4; i++) {
        const unitSlot = [-1, 0]
        assignUnit(unitSlot, wallTools, 999)
        wallLeft.push(unitSlot)
    }
    for (let i = 0; i < 4; i++) {
        const unitSlot = [-1, 0]
        assignUnit(unitSlot, wallTools, 999)
        wallRight.push(unitSlot)
    }
    for (let i = 0; i < 6; i++) {
        const unitSlot = [-1, 0]
        assignUnit(unitSlot, (i == 1 || i == 4) ? gateTools : wallTools, 999)
        wallMiddle.push(unitSlot)
    }

    sendXT("dfw", JSON.stringify({
        CX: castle.areaInfo.x,
        CY: castle.areaInfo.y,
        AID: castle.id,
        L: {
            S: wallLeft,
            UP: 37,
            UC: 0
        },
        M: {
            S: wallMiddle,
            UP: 26,
            UC: 0
        },
        R: {
            S: wallRight,
            UP: 37,
            UC: 0
        }
    }))
    console.log("setup wall/moat/gate/keep")
}
const eventID = 72
xtHandler.on("rpr", ({EID}) => {
    if (EID != eventID)
        return

    setupDefencesForKhan()
})
events.on("load", setupDefencesForKhan)
xtHandler.on("dfw", (_, r) => r != 0 ? setupDefencesForKhan() : undefined)
xtHandler.on("dfk", (_, r) => r != 0 ? setupDefencesForKhan() : undefined)
xtHandler.on("dfm", (_, r) => r != 0 ? setupDefencesForKhan() : undefined)