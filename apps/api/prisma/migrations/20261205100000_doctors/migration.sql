-- «پزشکان معتمد»: their own accounts (Super Admin), each linked to the insurers they work with
CREATE TABLE "Doctor" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "medicalCode" TEXT,
    "specialty" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Doctor_username_key" ON "Doctor"("username");

CREATE TABLE "DoctorInsurer" (
    "doctorId" TEXT NOT NULL,
    "insurerTenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DoctorInsurer_pkey" PRIMARY KEY ("doctorId","insurerTenantId")
);
CREATE INDEX "DoctorInsurer_insurerTenantId_idx" ON "DoctorInsurer"("insurerTenantId");
ALTER TABLE "DoctorInsurer" ADD CONSTRAINT "DoctorInsurer_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
