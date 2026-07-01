if (require('node:worker_threads').isMainThread)
  return module.exports = {
    pluginOptions: [
      {
        type: "Checkbox",
        key: "useScrews",
        default: true
      },
      {
        type: "Checkbox",
        key: "useBlackPowder",
        default: true
      },
      {
        type: "Checkbox",
        key: "useSaws",
        default: true
      },
      {
        type: "Checkbox",
        key: "useDrills",
        default: true
      },
      {
        type: "Checkbox",
        key: "useCrowbars",
        default: true
      },
      {
        type: "Checkbox",
        key: "useLeatherStrips",
        default: true
      },
      {
        type: "Checkbox",
        key: "useChains",
        default: true
      },
      {
        type: "Checkbox",
        key: "useMetalPlates",
        default: true
      },
    ]
  }

const { sendXT, events, waitForResult, botConfig } = require("../ggeBot")
const { resources, castles } = require("../protocols")
const craftingRecipes = require("../items/craftingRecipes.json")
const effects = require("../items/effects.json")
const effectTypes = require("../items/effecttypes.json")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
//%xt%EmpireEx_19%crun%1%{"KID":0,"AID":3750279,"OID":1968,"S":[1],"ST":"production"}%
//%xt%EmpireEx_19%crun%1%{"KID":0,"AID":3750279,"OID":1968,"S":[1],"ST":"queue"}%
class Recipe {
  constructor(e, i) {
    this.recipeID = e.CRID[i]
    this.remainingTime = Date.now() + e.RCT[i] * 1000
    this.tempSlotTime = e.RUT[i]
    this.booster = e.BV[i]
  }
}
class CraftingQueue {
  constructor({ CAI: craftingArea }) {
    for (let i = 0; i < craftingArea.length; i++) {
      const { CBI: craftingBuilding, CE: craftingEffects } = craftingArea[i]
      const areaID = craftingBuilding

      for (let i = 0; i < CRID.length; i++) {
        const recipes = new Recipe(craftingBuilding.QS, i)
      }
    }
  }
}

function getCraftingResources(CE) {
  const ungroupedActiveEffects = {}

  CE.forEach(([effectID, effectValues]) =>
    (ungroupedActiveEffects[effectID] ??= []).push(...effectValues))

  const activeEffects = {}
  for (const key in ungroupedActiveEffects) {
    let effectTypeID = effects.find(e => e.effectID == key).effectTypeID
    let effectType = effectTypes.find(e => e.effectTypeID == effectTypeID)
    activeEffects[effectType.name] ??= []
    activeEffects[effectType.name].push(...ungroupedActiveEffects[key])
  }

  const usedRecipeIDList = []
  const useableRecipes = activeEffects.enableCraftingRecipes.map(recipeID => {
    const recipe = craftingRecipes.find(e => e.craftingRecipeId == recipeID)

    if (!activeEffects.enableCraftingRecipeGroups?.find(craftingRecipeGroupID => craftingRecipeGroupID == recipe.recipeGroupID)) {
      return // console.warn("group not enabled")
    }
    return recipe

  }).filter(e => e !== undefined)
    .sort((a, b) => a.type.length - b.type.length)
    .sort((a, b) => b.level - a.level)
    .filter(recipes => {
      if (usedRecipeIDList.find(a => a == recipes.recipeGroupID))
        return
      usedRecipeIDList.push(recipes.recipeGroupID)
      return true
    })
    .filter(e => (e.costC2 ?? 0) == 0)

  const unlockedRecipes = {
    refinedLumber: useableRecipes.find(e => e.recipeGroupID == 1),
    refinedStone: useableRecipes.find(e => e.recipeGroupID == 2),
    screws: pluginOptions.useScrews ? useableRecipes.find(e => e.recipeGroupID == 3) : undefined,
    blackPowder: pluginOptions.useBlackPowder ? useableRecipes.find(e => e.recipeGroupID == 4) : undefined,
    saws: pluginOptions.useSaws ? useableRecipes.find(e => e.recipeGroupID == 5) : undefined,
    drills: pluginOptions.useDrills ? useableRecipes.find(e => e.recipeGroupID == 6) : undefined,
    crowbars: pluginOptions.useCrowbars ? useableRecipes.find(e => e.recipeGroupID == 7) : undefined,
    leatherStrips: pluginOptions.useLeatherStrips ? useableRecipes.find(e => e.recipeGroupID == 8) : undefined,
    chains: pluginOptions.useChains ? useableRecipes.find(e => e.recipeGroupID == 9) : undefined,
    metalPlates: pluginOptions.useChains ? useableRecipes.find(e => e.recipeGroupID == 10) : undefined,
    dragonScales: useableRecipes.find(e => e.recipeGroupID == 11),
    dragonCharms: useableRecipes.find(e => e.recipeGroupID == 12),
  }
  return unlockedRecipes
}

async function craftingAreas() {
  async function toolsmith(building, craftingResources) {
    if(building.PS.RUT.length == 0) {
      await sendXT("crun", JSON.stringify({KID: building.KID, AID: building.AID, OID: building.OID, S:[1], ST:"production"}))
      const [obj, r] = await waitForResult("crun", 1000 * 10, (o, r) => 
        r != 0 ? true : (o.OID == building.OID && o.KID == building.KID && o.AID == building.AID))
      if(r == 0)
        building = obj
    }
    // for (let i = 0; i < 2 - building.QS.RUT.length; i++) {
    //   await sendXT("crun", JSON.stringify({ KID: building.KID, AID: building.AID, OID: building.OID, S: [1], ST: "queue" }))
    //   const [obj, r] = await waitForResult("crun", 1000 * 10, (o, r) => 
    //     r != 0 ? true : (o.OID == building.OID && o.KID == building.KID && o.AID == building.AID))
    //   if (r == 0)
    //     building = obj
    // }

    const slotsAvailable = 2 + building.PS.RUT.length - building.PS.CRID.length +
      building.QS.RUT.length - building.QS.CRID.length
    if (slotsAvailable <= 0)
      return console.warn("No slots available")

    const castle = castles.find(a => a.kingdomID == building.KID && a.id == building.AID)

    for (let index = 0; index < slotsAvailable; index++) {
      const preferedResource = ([
        [craftingResources.screws, resources.screws, "screws"],
        [craftingResources.blackPowder, resources.blackPowder, "blackPowder"],
        [craftingResources.saws, resources.saws, "saws"],
        [craftingResources.drills, resources.drills, "drills"],
        [craftingResources.crowbars, resources.crowbars, "crowbars"],
        [craftingResources.leatherStrips, resources.leatherStrips, "leatherStrips"],
        [craftingResources.chains, resources.chains, "chains"],
        [craftingResources.metalPlates, resources.metalPlates, "metalPlates"],
      ].filter(([craftingResource]) =>
        craftingResource &&
        castle.oil >= (craftingResource.costOil ?? 0) &&
        castle.iron >= (craftingResource.costIron ?? 0) &&
        castle.glass >= (craftingResource.costGlass ?? 0) &&
        castle.coal >= (craftingResource.costCoal ?? 0) &&
        resources.refinedLumber >= (craftingResource.costRefinedLumber ?? 0) &&
        resources.refinedStone >= (craftingResource.costRefinedStone ?? 0))
        .sort((a, b) => a[1] - b[1]))?.[0]

      if (preferedResource == undefined)
        return console.log(`[Toolsmith] Could not select a resource`)

      let preferedResourceInfo = preferedResource[0]
      castle.coal -= (preferedResourceInfo.costCoal ?? 0)
      castle.oil -= (preferedResourceInfo.costOil ?? 0)
      castle.iron -= (preferedResourceInfo.costIron ?? 0)
      castle.glass -= (preferedResourceInfo.costGlass ?? 0)
      resources.refinedLumber -= (preferedResourceInfo.costRefinedLumber ?? 0)
      resources.refinedStone -= (preferedResourceInfo.costRefinedStone ?? 0)

      console.log(`[Toolsmith] Crafting resource ${preferedResource[2]}`)

      sendXT("crst", JSON.stringify({ KID: building.KID, AID: building.AID, OID: building.OID, PWR: 0, CRID: preferedResourceInfo.craftingRecipeId }))
    }
  }
  async function dragonHoard() {
    console.log("dragonHoard")
  }
  async function refinery(building, craftingResources) {
    const slotsAvailable = 2 + building.PS.RUT.length - building.PS.CRID.length +
      building.QS.RUT.length - building.QS.CRID.length
    if (slotsAvailable <= 0) {
      return console.warn("No slots available")
    }
    // else if (slotsAvailable < 0) {
    //   console.error("Alshrief needs to look into this.")

    //   console.error(JSON.stringify(building))
    //   return
    // }

    const castle = castles.find(a => a.kingdomID == building.KID && a.id == building.AID)

    for (let index = 0; index < slotsAvailable; index++) {
      let preferedResource = ([
        [craftingResources.refinedLumber, resources.refinedLumber, "refinedLumber"],
        [craftingResources.refinedStone, resources.refinedStone, "refinedStone"]
      ].filter(([craftingResource]) =>
        craftingResource &&
        resources.refinedLumber >= (craftingResource.costRefinedLumber ?? 0) &&
        resources.refinedStone >= (craftingResource.costRefinedStone ?? 0))
        .sort((a, b) => a[1] - b[1]))?.[0]

      if(!preferedResource)
        break

      let preferedResourceInfo = preferedResource[0]

      if(!preferedResourceInfo)
        break

      castle.stone -= (preferedResourceInfo.costStone ?? 0)
      castle.wood -= (preferedResourceInfo.costWood ?? 0)
      
      castle.emit("resourceUpdate")

      console.log(`[Toolsmith] Crafting resource ${preferedResource[2]}`)

      sendXT("crst", JSON.stringify({ KID: building.KID, AID: building.AID, OID: building.OID, PWR: 0, CRID: preferedResourceInfo.craftingRecipeId }))
    }
  }
  await sendXT("crin", JSON.stringify({}))
  let [obj] = await waitForResult("crin", 1000 * 10)
  obj.CAI.forEach(e => {
    const craftingResources = getCraftingResources(e.CE)
    e.CBI.forEach(building =>
      building.CQID == 1 ? refinery(building, craftingResources) :
        building.CQID == 2 ? toolsmith(building, craftingResources) :
          building.CQID == 3 ? dragonHoard(building, craftingResources) :
            console.warn(`Unknown recipe crafter: ${building.CQID}`)
    )
  })
}


events.once("load", () => {
  craftingAreas()
  setInterval(craftingAreas, 1000 * 60 * 60)
})

module.exports = craftingAreas