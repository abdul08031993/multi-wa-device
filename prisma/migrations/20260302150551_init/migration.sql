-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaAccount" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "waNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',

    CONSTRAINT "WaAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" SERIAL NOT NULL,
    "waAccountId" INTEGER NOT NULL,
    "recipient" TEXT NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 400,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "WaAccount_waNumber_key" ON "WaAccount"("waNumber");

-- AddForeignKey
ALTER TABLE "WaAccount" ADD CONSTRAINT "WaAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_waAccountId_fkey" FOREIGN KEY ("waAccountId") REFERENCES "WaAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
