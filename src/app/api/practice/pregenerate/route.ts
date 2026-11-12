import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { unauthorized } from "@/lib/api-errors";
import { generateAllVariants, parseStoredVariants } from "@/lib/practice-variants-server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return unauthorized("Authentication required");
    }

    try {
        const body = await req.json();
        const {
            errorItemId,
            questionText,
            knowledgePoints = [],
            language = "zh",
            gradeSemester = null,
            subjectName = "数学",
        } = body;

        // 如果传了 errorItemId，先检查数据库中是否已有缓存的变式题
        if (errorItemId) {
            const item = await prisma.errorItem.findUnique({
                where: { id: errorItemId },
                include: { subject: true },
            });
            if (item) {
                const existing = parseStoredVariants(item.ocrText);
                if (existing.hard && existing.harder && existing.medium) {
                    return NextResponse.json({ variants: existing, cached: true });
                }

                let tags: string[] = [];
                try {
                    tags = JSON.parse(item.knowledgePoints || "[]");
                } catch {
                    tags = [];
                }

                const variants = await generateAllVariants({
                    questionText: item.questionText || questionText || "",
                    knowledgePoints: tags.length > 0 ? tags : knowledgePoints,
                    language,
                    gradeSemester: item.gradeSemester || gradeSemester,
                    subjectName: item.subject?.name || subjectName,
                    existing,
                });

                await prisma.errorItem.update({
                    where: { id: item.id },
                    data: { ocrText: JSON.stringify(variants) },
                });

                return NextResponse.json({ variants, cached: false });
            }
        }

        // 上传预览阶段（尚未入库，没有 errorItemId）：直接并行预生成四档变式题（重点：困难 hard、挑战 harder）
        const variants = await generateAllVariants({
            questionText: questionText || "",
            knowledgePoints: Array.isArray(knowledgePoints) ? knowledgePoints : [],
            language,
            gradeSemester,
            subjectName,
        });

        return NextResponse.json({ variants, cached: false });
    } catch (error) {
        return NextResponse.json(
            { variants: {}, error: error instanceof Error ? error.message : "Pregenerate failed" },
            { status: 200 }
        );
    }
}
