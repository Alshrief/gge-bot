if (require('node:worker_threads').isMainThread) {
    module.exports = {
        description: 'hospital',
        pluginOptions: [
            {
                type: "Text",
                key: "checkInterval",
                default: "180"
            },
            {
                type: "Checkbox",
                key: "healInOuterKingdoms",
                default: true
            },
            {
                type: "Text",
                key: "maxSlotLimit",
                default: "5"
            }
        ]
    };
    return;
}

const { botConfig, events, sendXT, waitForResult, playerInfo } = require("../ggeBot.js");
const { setCastle, castles, KingdomID } = require("../protocols.js");
const unitsData = require("../items/units.json");
const buildingsData = require("../items/buildings.json");
const path = require("path");

const pluginOptions = botConfig.plugins[path.basename(__filename).slice(0, -3)] ?? {};

const hospitalWodIDs = [
    1, 2, 3, 4, 5, 463, 464, 465, 466, 467, 1940, // Military Hospital
    468, 20, 21, 22, 23, 80, 308, 309, 311, 312  // Field / Faction Hospital
];

// Mutex flag to prevent overlapping checks
let isChecking = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function checkAndHeal() {
    if (isChecking) return;
    isChecking = true;

    try {
        console.log("hospitalPluginStartChecking");
        let totalHealedCount = 0;
        let totalSlotsUsed = 0;
        let processedCastlesCount = 0;

        for (let i = 0; i < castles.length; i++) {
            const castle = castles[i];

            const healInOuterKingdoms = pluginOptions.healInOuterKingdoms !== undefined ? pluginOptions.healInOuterKingdoms : true;
            // Skip outer kingdoms if configured
            if (castle.kingdomID !== KingdomID.greatEmpire && !healInOuterKingdoms) {
                continue;
            }

            // Verify if castle has a hospital
            if (!castle.hasHospital) {
                continue;
            }

            // Skip early if there are no coin-healable wounded units in this castle locally
            const hasLocalHealable = (castle.hospitalInventory || []).some(w => {
                if (!w) return false;
                const wodID = w.wodID || (w.unitInfo ? w.unitInfo.wodID : (Array.isArray(w) ? w[0] : null));
                if (!wodID) return false;
                const unitDef = unitsData.find(u => u.wodID == wodID);
                if (!unitDef) return false;
                const coinCost = Number(unitDef.healingCostC1 || 0);
                const rubyCost = Number(unitDef.healingCostC2 || 0);
                return coinCost > 0 && rubyCost === 0 && w.amount > 0;
            });

            if (!hasLocalHealable) {
                continue;
            }

            // If we already processed at least one castle in this cycle, wait before checking/healing the next one to avoid server detection/ban
            if (processedCastlesCount > 0) {
                const delayMs = 5000 + Math.floor(Math.random() * 5000); // 5 to 10 seconds
                await sleep(delayMs);
            }

            processedCastlesCount++;

            try {
                await setCastle(castle, async () => {
                    // Refresh hospital inventory (HI)
                    await sendXT("hfl", JSON.stringify({ KID: castle.kingdomID, AID: castle.id, HRF: -1 }));
                    await waitForResult("hfl", 1000 * 10).catch(() => null);

                    // Query hospital queue slots (LID: 2)
                    await sendXT("spl", JSON.stringify({ LID: 2 }));
                    const [splObj, splRes] = await waitForResult("spl", 1000 * 10).catch(() => [null, -1]);
                    if (splRes !== 0 || !splObj || !splObj.PIDL) {
                        return;
                    }

                    // Find hospital building in this castle to calculate unlocked slots count
                    const buildingsList = castle.buildings || [];
                    const hospitalBuilding = buildingsList.find(b => hospitalWodIDs.includes(b.wodID));
                    if (!hospitalBuilding) {
                        return;
                    }

                    const bldInfo = buildingsData.find(x => x.wodID == hospitalBuilding.wodID);
                    const slotsCount = splObj && splObj.PIDL ? splObj.PIDL.length : (bldInfo ? Number(bldInfo.hospitalSlots || 1) : 1);

                    // Calculate free slots count
                    let occupiedSlots = splObj.PIDL.filter(slot => slot && slot[0] !== -1).length;
                    let freeSlots = slotsCount - occupiedSlots;

                    if (freeSlots <= 0) {
                        return;
                    }

                    // Check wounded units list
                    let woundedList = castle.hospitalInventory || [];
                    let healableWounded = woundedList.map(w => {
                        if (!w) return null;
                        const wodID = w.wodID || (w.unitInfo ? w.unitInfo.wodID : null);
                        if (!wodID) return null;
                        const unitDef = unitsData.find(u => u.wodID == wodID);
                        if (!unitDef) return null;

                        const coinCost = Number(unitDef.healingCostC1 || 0);
                        const rubyCost = Number(unitDef.healingCostC2 || 0);

                        // Only heal units that cost gold/coins, and not rubies
                        if (coinCost > 0 && rubyCost === 0) {
                            return {
                                wodID: wodID,
                                amount: w.amount,
                                coinCost: coinCost,
                                name: unitDef.comment2 || unitDef.name || String(wodID)
                            };
                        }
                        return null;
                    }).filter(Boolean);

                    if (healableWounded.length === 0) {
                        return;
                    }

                    // Determine maximum stack size based on the user-configured slot limit (defaults to 5)
                    const maxStackSize = Number(pluginOptions.maxSlotLimit || 5) || 5;

                    // Loop through healable units and treat them (supporting multi-batch healing per check)
                    for (const wounded of healableWounded) {
                        let remainingWounded = wounded.amount;

                        while (remainingWounded > 0 && freeSlots > 0) {
                            // Cap healing amount to maximum stack size to avoid TOO_MUCH_UNITS error
                            let amountToHeal = Math.min(remainingWounded, maxStackSize);
                            if (amountToHeal <= 0) break;

                            const availableCoins = playerInfo.coin !== undefined && !isNaN(playerInfo.coin) ? playerInfo.coin : 0;
                            const totalCost = wounded.coinCost * amountToHeal;

                            if (availableCoins < wounded.coinCost) {
                                break; // Cannot afford even a single unit of this type
                            }

                            // Adjust amount if player cannot afford full stack
                            if (availableCoins < totalCost) {
                                amountToHeal = Math.min(amountToHeal, Math.floor(availableCoins / wounded.coinCost));
                            }

                            if (amountToHeal <= 0) break;

                            let currentBatchSize = amountToHeal;
                            let success = false;

                            while (currentBatchSize > 0) {
                                await sendXT("hru", JSON.stringify({ U: wounded.wodID, A: currentBatchSize }));
                                const [hruResponse, hruResult] = await waitForResult("hru", 1000 * 10).catch(() => [null, -1]);

                                if (hruResult === 0 && hruResponse) {
                                    totalHealedCount += currentBatchSize;
                                    totalSlotsUsed += 1;
                                    freeSlots--;
                                    remainingWounded -= currentBatchSize;
                                    success = true;

                                    // Update coin count locally
                                    if (playerInfo.coin !== undefined) {
                                        playerInfo.coin -= (wounded.coinCost * currentBatchSize);
                                    }

                                    // Update local variables from fresh server response
                                    if (hruResponse.gui && hruResponse.gui.HI) {
                                        woundedList = hruResponse.gui.HI.map(x => ({
                                            unitInfo: { wodID: x[0] },
                                            amount: Number(x[1])
                                        }));
                                    }

                                    if (hruResponse.spl && hruResponse.spl.PIDL) {
                                        occupiedSlots = hruResponse.spl.PIDL.filter(slot => slot && slot[0] !== -1).length;
                                        freeSlots = slotsCount - occupiedSlots;
                                    }
                                    break;
                                } else if (hruResult === 88 && currentBatchSize > 5) {
                                    // TOO_MUCH_UNITS: Fallback to 5 and try again!
                                    console.log(`[Hospital] TOO_MUCH_UNITS for batch size ${currentBatchSize}. Falling back to 5.`);
                                    currentBatchSize = 5;
                                } else {
                                    break; // Stop trying to heal this type if it failed with other errors
                                }
                            }

                            if (!success) {
                                break; // Stop loop if the retry also failed
                            }
                        }
                    }
                });
            } catch (castleErr) {
                // Keep error logs quiet unless critical
            }
        }

        if (totalHealedCount > 0) {
            console.log("hospitalFinishedHealingTotalStart", totalHealedCount, "hospitalFinishedHealingSlots", totalSlotsUsed, "hospitalFinishedHealingSlotsEnd");
        } else {
            console.log("hospitalNoHealingDone");
        }
    } catch (err) {
        console.error("Uncaught error in hospital checkAndHeal loop:", err);
    } finally {
        isChecking = false;
    }
}

events.on("load", async () => {
    // Perform initial run
    setTimeout(checkAndHeal, 5000);

    // Setup periodic interval check
    const intervalMin = parseFloat(pluginOptions.checkInterval || "180") || 180;
    setInterval(checkAndHeal, intervalMin * 60 * 1000).unref();
});
