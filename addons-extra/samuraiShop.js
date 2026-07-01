if(require('node:worker_threads').isMainThread)
    return module.exports = {}

const packages = require('../items/packages.json')
const { events, sendXT, waitForResult } = require('../ggeBot')
const eventID = 80

events.on("eventStart", async eventInfo => {
    if (eventInfo.EID != eventID)
        return

    await sendXT("gbc", JSON.stringify({CID: 3550580, KID: 0}))

    const gbc = (await waitForResult("gbc", 1000 * 10))[0]

    const packagesToBuy = [
        3322,
        3321,
        3320,
        3330,
        3329,
        3328,
        3314,
        3313,
        3312
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
        const buyAmmount = Math.min(packagesLeft, Math.floor(eventPoints / packageInfo.costSamuraiToken))
        if(buyAmmount <= 0)
            return

        eventPoints -= buyAmmount * packageInfo.costSamuraiToken
        
        package.AMT += buyAmmount
        
        sendXT("sbp", JSON.stringify({ 
            PID: packageID, BT: 0, TID: eventID, 
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
        const samsEventInfo = (await waitForResult("pep", 1000 * 10, o => o?.EID == eventID))[0]
        let eventPoints = samsEventInfo.OP[0]
        packagesToBuy.forEach((id,i) => tryAndBuyPackage(id, i, eventPoints))
        if (packagesToBuy.length == 0) {
            console.log("broughtShop")
            clearInterval(timer)
        }
    }
    const timer = setInterval(checkForBuyAblePackages, 1000 * 60)
    checkForBuyAblePackages()
})