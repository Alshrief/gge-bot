if (require('node:worker_threads').isMainThread) {
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "ticketAmmount"
            }
        ]
    }
}

const { events, sendXT, waitForResult, botConfig } = require('../ggeBot')
const { resources } = require('../protocols')

const eventID = 89
const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const spendTix = async eventInfo => {
    if (eventInfo.EID != eventID)
        return

    events.off("eventStart", spendTix)

    let ticketAmmount = parseInt(pluginOptions.ticketAmmount)
    if (ticketAmmount == undefined || isNaN(ticketAmmount))
        ticketAmmount = Infinity

    while (resources.saleDaysLuckyWheelTicket != 0 && 0 < ticketAmmount--) {
        await sendXT("lws", JSON.stringify({ LWET: 1 }))
        await waitForResult("sce", 1000 * 8)
    }
    console.log("affluenceTicketsSpent")
}
events.on("eventStart", spendTix)