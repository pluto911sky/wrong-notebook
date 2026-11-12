import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KID_PRIZES = [
    {
        name: "🍦 自选美味零食券",
        description: "可自主挑选一份平时限制的冰淇淋、奶茶或膨化零食，由家长买单！",
        weight: 25,
        stock: null, // 不限量
        sortOrder: 1,
        isBlank: false,
    },
    {
        name: "🍔 豪华大餐任选卡",
        description: "周末由你全权决定吃什么大餐（汉堡、披萨、火锅或自助餐），全家一起去！",
        weight: 15,
        stock: null,
        sortOrder: 2,
        isBlank: false,
    },
    {
        name: "💰 自由零花钱基金",
        description: "获得 20 元自由支配零花钱，可存入小金库或购买自己喜欢的小物品。",
        weight: 20,
        stock: null,
        sortOrder: 3,
        isBlank: false,
    },
    {
        name: "👑 霸气愿望特权卡",
        description: "家长无条件答应你一个合理要求（如今天晚睡半小时、看一集动画片等）。",
        weight: 10,
        stock: null,
        sortOrder: 4,
        isBlank: false,
    },
    {
        name: "🎁 心愿礼物兑换券",
        description: "挑选一个心仪已久的文具盒、玩具盲盒、手办或小乐高积木！",
        weight: 12,
        stock: null,
        sortOrder: 5,
        isBlank: false,
    },
    {
        name: "🏖️ 周末出行游玩日",
        description: "周末去一次你最想去的游乐园、动物园、科技馆或户外露营公园！",
        weight: 8,
        stock: null,
        sortOrder: 6,
        isBlank: false,
    },
    {
        name: "🎮 畅玩游戏时间卡",
        description: "额外奖励 30 分钟周末平板或游戏自由体验时间，开心畅玩！",
        weight: 18,
        stock: null,
        sortOrder: 7,
        isBlank: false,
    },
    {
        name: "🌟 免做家务偷懒券",
        description: "可以把一次扫地或扔垃圾的任务光明正大地转交给爸爸/妈妈！",
        weight: 15,
        stock: null,
        sortOrder: 8,
        isBlank: false,
    },
    {
        name: "🐾 算算喵的亲密大拥抱",
        description: "算算喵给你一个超级大拥抱！积蓄满满欧气，下一次升级必中大奖！",
        weight: 12,
        stock: null,
        sortOrder: 9,
        isBlank: true,
    },
];

async function main() {
    console.log("Seeding kid-friendly lottery prizes...");

    // 把旧的 seed-thanks 停用
    await prisma.prize.updateMany({
        where: { id: "seed-thanks" },
        data: { enabled: false },
    });

    for (const p of KID_PRIZES) {
        const existing = await prisma.prize.findFirst({
            where: { name: p.name },
        });
        if (!existing) {
            await prisma.prize.create({
                data: p,
            });
            console.log(`Created prize: ${p.name}`);
        } else {
            await prisma.prize.update({
                where: { id: existing.id },
                data: p,
            });
            console.log(`Updated prize: ${p.name}`);
        }
    }

    console.log("All kid prizes seeded successfully!");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
