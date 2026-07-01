// ============================================================
//  produceTools.js  –  Plugin انتاج أدوات الحصار والدفاع
//  يعمل بنفس طريقة barracks.js لكن للأدوات
//  استخدم LID=1 و SID=0 (مطابق لـ req.txt)
// ============================================================

if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            // ── اختار الأداة ──────────────────────────────────────
            {
                type: "Select",
                key: "toolType",
                selection: [
                    // ── أدوات هجوم أساسية ──
                    "Scaling Ladder (سلم الاقتحام)",
                    "Battering Ram (كبش الهدم)",
                    "Mantlet (ترس واقٍ)",
                    "Banner (راية)",
                    "Loot Sack (كيس الغنيمة)",
                    "Wood Bundle (حزمة خشب)",
                    // ── أدوات دفاع أساسية ──
                    "Hurling Rocks (قذف الصخور)",
                    "Castle Gate Reinforcement (تقوية البوابة)",
                    "Flaming Arrows (سهام مشتعلة)",
                    "Dummy Melee Soldiers (دمية مشاة)",
                    "Dummy Ranged Soldiers (دمية رماة)",
                    "Sharpened Stakes (أوتاد مدببة)",
                    // ── أدوات هجوم مزدوجة ──
                    "Fortified Ram (كبش محصّن) - مزدوجة هجوم",
                    "Glory Tower (برج المجد) - مزدوجة هجوم",
                    "Hookshot Cannon (مدفع الخطاف) - مزدوجة هجوم",
                    "Hwacha (هواتشا) - مزدوجة هجوم",
                    "Siege Mortar (هاون الحصار) - مزدوجة هجوم",
                    "Shrapnel Bomb (قنبلة الشظايا) - مزدوجة هجوم",
                    "Organ Cannon (المدفع الأورغن) - مزدوجة هجوم",
                    "Hand Cannon (مدفع يدوي) - مزدوجة هجوم",
                    "Assault Flamethrower (رمّاح النار) - مزدوجة هجوم",
                    "Warwagon (عربة الحرب) - مزدوجة هجوم",
                    // ── أدوات دفاع مزدوجة ──
                    "Thunder Crash Bomb (قنبلة الرعد) - مزدوجة دفاع",
                    "Trebuchet (المنجنيق) - مزدوجة دفاع",
                    "Field Cannon (مدفع الميدان) - مزدوجة دفاع",
                    "Water Mine (لغم مائي) - مزدوجة دفاع",
                    "Spike Board (لوح الأشواك) - مزدوجة دفاع",
                    "Spear Trap (فخ الرماح) - مزدوجة دفاع",
                    "Fire Trap (فخ الحريق) - مزدوجة دفاع",
                    "Wooden Hoarding (إسناد خشبي) - مزدوجة دفاع",
                    "Wheeled Cauldron (مرجل دوّار) - مزدوجة دفاع",
                    "Explosive Arrows (سهام متفجرة) - مزدوجة دفاع",
                ],
                default: "0"
            },
            // ── مستوى الأداة (للأدوات المزدوجة فقط: 0=أضعف، 9=أقوى؛ الأدوات الأساسية تجاهل) ──
            {
                type: "Text",
                key: "level",
                default: "0"
            },
            // ── اختار الممالك ─────────────────────────────────────
            { type: "Label", key: "kingdomsLabel" },
            {
                type: "Checkbox",
                key: "greatEmpire",
                default: true
            },
            {
                type: "Checkbox",
                key: "burningSands",
                default: true
            },
            {
                type: "Checkbox",
                key: "everWinterGlacier",
                default: true
            },
            {
                type: "Checkbox",
                key: "firePeaks",
                default: true
            },
            {
                type: "Checkbox",
                key: "randomizeTiming",
                default: false
            },
        ]
    }

// ============================================================
//  قسم التشغيل
// ============================================================

const { botConfig } = require("../ggeBot.js")
const { KingdomID, castles, setCastle } = require("../protocols.js")
const { sendXT, waitForResult, events } = require("../ggeBot.js")
const units   = require("../items/units.json")

const pluginOptions =
    botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

// ── جدول الأدوات [index يطابق selection بالأعلى] ────────────
// workshopType: "Workshop" = ورشة هجوم | "Dworkshop" = ورشة دفاع
const TOOL_TABLE = [
    // أدوات هجوم أساسية (لا مستوى)
    { baseWodID: 614, label: "Scaling Ladder",          workshopType: "Workshop",  isCombo: false },
    { baseWodID: 611, label: "Battering Ram",            workshopType: "Workshop",  isCombo: false },
    { baseWodID: 620, label: "Mantlet",                  workshopType: "Workshop",  isCombo: false },
    { baseWodID: 660, label: "Banner",                   workshopType: "Workshop",  isCombo: false },
    { baseWodID: 653, label: "Loot Sack",                workshopType: "Workshop",  isCombo: false },
    { baseWodID: 617, label: "Wood Bundle",              workshopType: "Workshop",  isCombo: false },
    // أدوات دفاع أساسية (لا مستوى)
    { baseWodID: 637, label: "Hurling Rocks",            workshopType: "Dworkshop", isCombo: false },
    { baseWodID: 626, label: "Castle Gate Reinforcement",workshopType: "Dworkshop", isCombo: false },
    { baseWodID: 629, label: "Flaming Arrows",           workshopType: "Dworkshop", isCombo: false },
    { baseWodID: 632, label: "Dummy Melee Soldiers",     workshopType: "Dworkshop", isCombo: false },
    { baseWodID: 633, label: "Dummy Ranged Soldiers",    workshopType: "Dworkshop", isCombo: false },
    { baseWodID: 634, label: "Sharpened Stakes",         workshopType: "Dworkshop", isCombo: false },
    // أدوات هجوم مزدوجة (لها مستوى 0-9)
    { baseWodID: 245, label: "Fortified Ram",            workshopType: "Workshop",  isCombo: true  },
    { baseWodID: 256, label: "Glory Tower",              workshopType: "Workshop",  isCombo: true  },
    { baseWodID: 267, label: "Hookshot Cannon",          workshopType: "Workshop",  isCombo: true  },
    { baseWodID: 278, label: "Hwacha",                   workshopType: "Workshop",  isCombo: true  },
    { baseWodID: 289, label: "Siege Mortar",             workshopType: "Workshop",  isCombo: true  },
    { baseWodID: 359, label: "Shrapnel Bomb",            workshopType: "Workshop",  isCombo: true  },
    { baseWodID: 370, label: "Organ Cannon",             workshopType: "Workshop",  isCombo: true  },
    { baseWodID: 381, label: "Hand Cannon",              workshopType: "Workshop",  isCombo: true  },
    { baseWodID: 391, label: "Assault Flamethrower",     workshopType: "Workshop",  isCombo: true  },
    { baseWodID: 401, label: "Warwagon",                 workshopType: "Workshop",  isCombo: true  },
    // أدوات دفاع مزدوجة (لها مستوى 0-9)
    { baseWodID: 300, label: "Thunder Crash Bomb",       workshopType: "Dworkshop", isCombo: true  },
    { baseWodID: 315, label: "Trebuchet",                workshopType: "Dworkshop", isCombo: true  },
    { baseWodID: 326, label: "Field Cannon",             workshopType: "Dworkshop", isCombo: true  },
    { baseWodID: 337, label: "Water Mine",               workshopType: "Dworkshop", isCombo: true  },
    { baseWodID: 348, label: "Spike Board",              workshopType: "Dworkshop", isCombo: true  },
    { baseWodID: 421, label: "Spear Trap",               workshopType: "Dworkshop", isCombo: true  },
    { baseWodID: 431, label: "Fire Trap",                workshopType: "Dworkshop", isCombo: true  },
    { baseWodID: 441, label: "Wooden Hoarding",          workshopType: "Dworkshop", isCombo: true  },
    { baseWodID: 451, label: "Wheeled Cauldron",         workshopType: "Dworkshop", isCombo: true  },
    { baseWodID: 462, label: "Explosive Arrows",         workshopType: "Dworkshop", isCombo: true  },
]

// ── قائمة WodID لمبنى الورشة (Workshop) و (Dworkshop) ──
// Workshop  = 165, 166, 167, 256  (levels 1-4)
// Dworkshop = 176, 177, 178, 257  (levels 1-4)
const WORKSHOP_BUILDING_WIDS  = [165, 166, 167, 256]
const DWORKSHOP_BUILDING_WIDS = [176, 177, 178, 257]

// ── ابنِ سلسلة ترقيات الأداة ──────────────────────────────
function buildToolWodIDList(baseWodID) {
    const list = []
    let start   = baseWodID
    const seen  = new Set()
    while (start && !seen.has(start)) {
        const item = units.find(u => u?.wodID == start)
        if (!item) break
        list.push(item.wodID)
        seen.add(start)
        if (!item.upgradeWodID) break
        start = Number(item.upgradeWodID)
    }
    return list
}

// ── الأداة المختارة ──────────────────────────────────────
const selectedToolInfo = TOOL_TABLE[Number(pluginOptions.toolType ?? 0)]

if (!selectedToolInfo) {
    console.warn("[produceTools] لم يتم اختيار أداة صحيحة")
}

const toolWodIDList = selectedToolInfo ? buildToolWodIDList(selectedToolInfo.baseWodID) : []
const level         = Math.max(0, Math.min(Number(pluginOptions.level ?? 0), toolWodIDList.length - 1))
const selectedWodID = toolWodIDList[level] ?? toolWodIDList[0]

const buildingWodIDList = selectedToolInfo?.workshopType === "Dworkshop"
    ? DWORKSHOP_BUILDING_WIDS
    : WORKSHOP_BUILDING_WIDS

// ── دالة لتحديد اسم القلعة أو المملكة بالعربية لتبسيط السجلات ──
function getCastleName(castle) {
    const rawName = castle.name || castle.areaInfo?.extraData?.[3]
    if (rawName && typeof rawName === 'string' && rawName.trim() !== "" && isNaN(rawName)) {
        return rawName.trim()
    }

    const mainCastle = castles.find(c => c.kingdomID === castle.kingdomID)
    if (castle.kingdomID === 0) {
        if (castle.id === mainCastle?.id) {
            return "المملكة العظمى (القلعة الرئيسية)"
        } else {
            return "المملكة العظمى (قاعدة)"
        }
    }
    const names = {
        1: "مملكة الجليد الأزلي",
        2: "مملكة الصحراء",
        3: "مملكة القمم"
    }
    return names[castle.kingdomID] || `مملكة`
}

// ── دالة انتاج الأدوات لقلعة واحدة ──────────────────────
const produceForCastle = (castle, index) => setCastle(castle, async () => {
    index ??= 0

    // ادخل القلعة لتحديث بياناتها
    await sendXT("jca", JSON.stringify({ CID: castle.id, KID: castle.kingdomID }))
    const [jaaObj] = await waitForResult("jaa", 1000 * 10,
        o => o.grc?.KID == castle.kingdomID && o.grc?.AID == castle.id)

    // ── التحقق من وجود مبنى الورشة في القلعة ──
    const buildingList = []
    if (jaaObj.gca?.BD) buildingList.push(...jaaObj.gca.BD)
    if (jaaObj.gca?.FP) buildingList.push(...jaaObj.gca.FP)

    const hasWorkshop = buildingList.some(b => buildingWodIDList.includes(Number(b[0])))

    if (!hasWorkshop) {
        const castleName = getCastleName(castle)
        const workshopName = selectedToolInfo.workshopType === "Workshop" ? "ورشة حصار (الهجوم)" : "ورشة دفاع"
        console.log(`[produceTools] ${castleName} لا يوجد فيها ${workshopName}!`)
        return 0
    }

    // اطلب حالة قائمة الانتاج - LID=1 مطابق لـ req.txt
    await sendXT("spl", JSON.stringify({ LID: 1 }))
    const [splObj] = await waitForResult("spl", 1000 * 10)

    let toolsProduced = 0

    // الـ QS هي فتحات قائمة الانتظار — نحاول كل فتحة فارغة
    for (let i = 0; i < splObj.QS.length; i++) {
        const slot = splObj.QS[i]

        // الفتحة مشغولة بأداة جاري تصنيعها → تجاهل
        if (slot.P) continue

        // الفتحة مقفولة (RUT=0) → تجاهل
        if (slot.SI?.RUT === 0) continue

        await sendXT("bup", JSON.stringify({
            LID: 1,
            WID: selectedWodID,
            AMT: 80,        // كمية 80 مثل req.txt
            PO: -1,
            PWR: 0,
            SK: 73,
            SID: 0,         // SID=0 للأدوات (مطابق req.txt)
            AID: castle.id
        }))

        const [, result] = await waitForResult("bup", 1000 * 10)
        if (result != 0) {
            console.warn(`[produceTools] فشل الانتاج في الفتحة ${i} - KID=${castle.kingdomID} AID=${castle.id}`)
            continue
        }

        toolsProduced += 80
    }

    if (toolsProduced > 0)
        console.log(`[produceTools] تم بدء إنتاج ${toolsProduced}x ${selectedToolInfo.label} في KID=${castle.kingdomID} AID=${castle.id}`)

    // ── انتظر أقل وقت (PS.RCT) = كل ما خانة تفضي يملأها فوراً ──
    await sendXT("spl", JSON.stringify({ LID: 1 }))
    const [splObj2] = await waitForResult("spl", 1000 * 10)

    // PS.RCT = الوقت المتبقي لأول خانة تخلص
    const nextCheckInSeconds = splObj2.PS?.RCT ?? 3600
    console.log(`[produceTools] هيعدي ${nextCheckInSeconds} ثانية وبعدين يملأ الخانة الفاضية`)
    setTimeout(() => produceForCastle(castle), nextCheckInSeconds * 1000)

    return toolsProduced
})

// ── الدخول بعد تحميل البوت ──────────────────────────────
events.once("load", async () => {
    if (!selectedToolInfo || !selectedWodID) {
        console.warn("[produceTools] لا توجد أداة مختارة — يُرجى ضبط الإعدادات")
        return
    }

    console.log(`[produceTools] الأداة: ${selectedToolInfo.label}`)

    // ── الممالك المفعّلة ──
    const enabledKingdoms = []
    if (pluginOptions.greatEmpire)       enabledKingdoms.push(KingdomID.greatEmpire)
    if (pluginOptions.burningSands)      enabledKingdoms.push(KingdomID.burningSands)
    if (pluginOptions.everWinterGlacier) enabledKingdoms.push(KingdomID.everWinterGlacier)
    if (pluginOptions.firePeaks)         enabledKingdoms.push(KingdomID.firePeaks)

    if (enabledKingdoms.length === 0) {
        console.warn("[produceTools] لم يتم تحديد أي مملكة!")
        return
    }

    let totalProduced = 0

    for (let i = 0; i < castles.length; i++) {
        const castle = castles[i]

        // تجاهل الممالك الخارجية (جزر العاصفة / بيريموند)
        if ([KingdomID.stormIslands, KingdomID.berimond].includes(castle.kingdomID))
            continue

        // تجاهل الممالك غير المحددة
        if (!enabledKingdoms.includes(castle.kingdomID))
            continue

        try {
            if (pluginOptions.randomizeTiming) {
                const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1) + min)
                await new Promise(r => setTimeout(r, rnd(3 * i, 2.5 * i) * 1000))
            }
            totalProduced += await produceForCastle(castle, i)
        } catch (e) {
            console.warn("[produceTools]", e)
        }
    }

    console.log(`[produceTools] إجمالي الانتاج: ${totalProduced}`)
})
