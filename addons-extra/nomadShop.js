if(require('node:worker_threads').isMainThread)
    return module.exports = {}

const packages = require("../items/packages.json")
const { events, sendXT, waitForResult } = require("../ggeBot")

const eventID = 72
events.on("eventStart", async eventInfo => {
    if (eventInfo.EID != eventID)
        return
    
    await sendXT("gbc", JSON.stringify({CID: 3750279, KID: 0}))
    
    const gbc = (await waitForResult("gbc", 1000 * 10))[0]

    const packagesToBuy = [
        3215,
        3214,
        3213,
        3223, 
        3222,
        3221,
        3207,
        3206,
        3205
    ]
    function tryAndBuyPackage(packageID, index, eventPoints) {
        const packageInfo = packages.find(e => e.packageID == packageID)
        let package = gbc.PL.find(e => Number(e.PID) == packageID)
        if(!package)
        {
            package = {PID: packageID, AMT: 0}
            gbc.PL.push(package)
        }
        const packagesLeft = Number(packageInfo.stock) - package.AMT
        const buyAmmount = Math.min(packagesLeft, Math.floor(eventPoints / packageInfo.costKhanTablet))
        if(buyAmmount <= 0)
            return

        eventPoints -= buyAmmount * packageInfo.costKhanTablet
        
        package.AMT += buyAmmount
        
        sendXT("sbp", JSON.stringify({ 
            PID: packageID, BT: 0, TID: 94, 
            AMT: buyAmmount, 
            KID: 0, AID: -1, PC2: -1, 
            BA: 0, PWR: 0, _PO: -1 
        }))
        
        console.log("shopBuying", `${packageInfo.comment2} x${buyAmmount}`)
        if((Number(packageInfo.stock) - package.AMT) <= 0)
           packagesToBuy.splice(index, 1)

        return
    }
    const checkForBuyAblePackages = async () => {
        await sendXT("pep", JSON.stringify({ EID: eventID }))
        const nomadEventInfo = (await waitForResult("pep", 1000 * 10, o => o?.EID == eventID))[0]
        let eventPoints = nomadEventInfo.OP[0]
        packagesToBuy.forEach((id,i) => tryAndBuyPackage(id, i, eventPoints))
        if (packagesToBuy.length == 0) {
            console.log("broughtShop")
            clearInterval(timer)
        }
    }
    var timer = setInterval(checkForBuyAblePackages, 1000 * 60)
    checkForBuyAblePackages()
})