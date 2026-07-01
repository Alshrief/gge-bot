if(require('node:worker_threads').isMainThread)
    return module.exports = {}

const { xtHandler, sendXT, waitForResult } = require("../ggeBot")

xtHandler.on("bie", async obj => {
    if (obj.GE?.find(e => e == 2) != undefined)
        return
    
    await sendXT("usg", JSON.stringify({}))
    let [obj2] = await waitForResult("usg", 1000 * 8)

    if (obj2?.SGE?.find(e => e == 2)) {
        await sendXT("agb", JSON.stringify({ GEID: 2 }))
        const [obj] = await waitForResult("agb", 1000 * 8, (obj,r) => r != 0 || obj.GEID == 2)
        if(obj.CC2T)
            await sendXT("agb", JSON.stringify({cmdID:"agb", GEID:2, CC2T: obj.CC2T}))
        console.log("gettingSpeedGlobalEffect")
    }
})