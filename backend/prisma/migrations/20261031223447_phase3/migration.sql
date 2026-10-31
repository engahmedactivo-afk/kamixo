-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('TRANSCODE', 'SUBTITLES', 'DUB');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "CoinPack" ADD COLUMN     "priceCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "dubs" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "sourcePath" TEXT;

-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "sourceLang" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "studioId" TEXT;

-- AlterTable
ALTER TABLE "VipPlan" ADD COLUMN     "priceCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "episodeId" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Studio" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "revenueSharePct" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Studio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeriesSimilarity" (
    "seriesId" TEXT NOT NULL,
    "relatedId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SeriesSimilarity_pkey" PRIMARY KEY ("seriesId","relatedId")
);

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_episodeId_idx" ON "Job"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Studio_apiKey_key" ON "Studio"("apiKey");

-- CreateIndex
CREATE INDEX "SeriesSimilarity_seriesId_score_idx" ON "SeriesSimilarity"("seriesId", "score");

-- CreateIndex
CREATE INDEX "Series_studioId_idx" ON "Series"("studioId");

-- AddForeignKey
ALTER TABLE "Series" ADD CONSTRAINT "Series_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
