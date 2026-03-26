import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding database...');

    // Seed plans
    const plans = [
        {
            code: 'free',
            name: 'Free',
            monthlyPriceCents: 0,
            monthlyCredits: 50,
            featuresJson: {
                maxCharacters: 1,
                maxImagesPerJob: 2,
                videoGeneration: false,
                faceSwap: false,

                priorityQueue: false,
            },
        },
        {
            code: 'creator-monthly',
            name: 'Creator Monthly',
            monthlyPriceCents: 3200,
            monthlyCredits: 500,
            featuresJson: {
                maxCharacters: 5,
                maxImagesPerJob: 4,
                videoGeneration: true,
                faceSwap: true,
                priorityQueue: false,
            },
        },
        {
            code: 'creator-yearly',
            name: 'Creator Yearly',
            monthlyPriceCents: 15000,
            monthlyCredits: 6000,
            featuresJson: {
                maxCharacters: 5,
                maxImagesPerJob: 4,
                videoGeneration: true,
                faceSwap: true,
                priorityQueue: false,
                billingInterval: 'year',
            },
        },
        {
            code: 'pro-monthly',
            name: 'Pro Monthly',
            monthlyPriceCents: 7500,
            monthlyCredits: 2000,
            featuresJson: {
                maxCharacters: 20,
                maxImagesPerJob: 8,
                videoGeneration: true,
                faceSwap: true,
                priorityQueue: true,
            },
        },
        {
            code: 'pro-yearly',
            name: 'Pro Yearly',
            monthlyPriceCents: 36000,
            monthlyCredits: 24000,
            featuresJson: {
                maxCharacters: 20,
                maxImagesPerJob: 8,
                videoGeneration: true,
                faceSwap: true,
                priorityQueue: true,
                billingInterval: 'year',
            },
        },
        {
            code: 'business-monthly',
            name: 'Business Monthly',
            monthlyPriceCents: 17000,
            monthlyCredits: 10000,
            featuresJson: {
                maxCharacters: -1,
                maxImagesPerJob: 16,
                videoGeneration: true,
                faceSwap: true,
                priorityQueue: true,
                apiAccess: true,
                whiteLabel: true,
            },
        },
        {
            code: 'business-yearly',
            name: 'Business Yearly',
            monthlyPriceCents: 80000,
            monthlyCredits: 120000,
            featuresJson: {
                maxCharacters: -1,
                maxImagesPerJob: 16,
                videoGeneration: true,
                faceSwap: true,
                priorityQueue: true,
                apiAccess: true,
                whiteLabel: true,
                billingInterval: 'year',
            },
        },
    ];

    for (const plan of plans) {
        await prisma.plan.upsert({
            where: { code: plan.code },
            update: plan,
            create: plan,
        });
        console.log(`  ✅ Plan: ${plan.name} (${plan.code})`);
    }

    // Seed style packs
    const stylePacks = [
        {
            name: 'Photorealistic Portrait',
            slug: 'photorealistic-portrait',
            description: 'High-quality photorealistic portrait generation',
            baseCost: 5,
            configJson: {
                defaultPromptPrefix: 'photorealistic, high quality, detailed, 8k',
                defaultNegativePrompt: 'blurry, deformed, low quality, cartoon, anime',
                defaultGuidance: 7.0,
                defaultSteps: 30,
            },
        },
        {
            name: 'Editorial Fashion',
            slug: 'editorial-fashion',
            description: 'High-fashion editorial photography style',
            baseCost: 8,
            configJson: {
                defaultPromptPrefix: 'editorial fashion photography, vogue style, professional lighting',
                defaultNegativePrompt: 'amateur, low quality, blurry, deformed',
                defaultGuidance: 6.5,
                defaultSteps: 35,
            },
        },
        {
            name: 'Glamour',
            slug: 'glamour',
            description: 'Glamour and boudoir photography style',
            baseCost: 10,
            configJson: {
                defaultPromptPrefix: 'glamour photography, professional studio, soft lighting, alluring',
                defaultNegativePrompt: 'low quality, blurry, deformed, amateur',
                defaultGuidance: 7.5,
                defaultSteps: 35,
            },
        },
        {
            name: 'Artistic Nude',
            slug: 'artistic-nude',
            description: 'Artistic fine-art style generation',
            baseCost: 12,
            configJson: {
                defaultPromptPrefix: 'fine art photography, artistic, professional, beautiful composition',
                defaultNegativePrompt: 'low quality, blurry, deformed, amateur',
                defaultGuidance: 7.0,
                defaultSteps: 40,
                nsfw: true,
            },
        },
        {
            name: 'Fantasy',
            slug: 'fantasy',
            description: 'Fantasy and sci-fi style generation',
            baseCost: 8,
            configJson: {
                defaultPromptPrefix: 'fantasy art, ethereal, magical, cinematic lighting',
                defaultNegativePrompt: 'low quality, blurry, deformed',
                defaultGuidance: 8.0,
                defaultSteps: 35,
            },
        },
        {
            name: 'Cinematic',
            slug: 'cinematic',
            description: 'Movie-still quality cinematic shots',
            baseCost: 8,
            configJson: {
                defaultPromptPrefix: 'cinematic still, movie scene, dramatic lighting, 35mm film',
                defaultNegativePrompt: 'low quality, blurry, amateur, overexposed',
                defaultGuidance: 7.0,
                defaultSteps: 30,
            },
        },
    ];

    for (const pack of stylePacks) {
        await prisma.stylePack.upsert({
            where: { slug: pack.slug },
            update: pack,
            create: pack,
        });
        console.log(`  ✅ Style Pack: ${pack.name}`);
    }

    console.log('\n✨ Seeding complete!');
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
