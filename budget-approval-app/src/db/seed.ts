/**
 * Demo data seed: cost centers, GL accounts, fiscal limits, and a small
 * org chart of users covering every role so the approval chain
 * (Line Manager -> Department Head -> Finance Controller) can be exercised
 * end to end. Run with `npx tsx src/db/seed.ts`.
 */
import "dotenv/config";
import { db, pool } from "./client";
import { costCenters, glAccounts, fiscalLimits, users } from "./schema";

async function main() {
  const [plant, it, finance] = await db
    .insert(costCenters)
    .values([
      { code: "CC-1000", name: "Plant Operations", department: "Operations", plant: "Plant 1 - Suez" },
      { code: "CC-2000", name: "IT Infrastructure", department: "Information Technology", plant: "HQ" },
      { code: "CC-3000", name: "Finance & Controlling", department: "Finance", plant: "HQ" },
    ])
    .returning();

  const [aucPlant, aucIt, opex] = await db
    .insert(glAccounts)
    .values([
      { code: "160000", name: "AUC - Plant & Machinery", accountType: "CAPEX", defaultAssetClass: "AUC-PLANT" },
      { code: "160100", name: "AUC - IT Equipment", accountType: "CAPEX", defaultAssetClass: "AUC-IT" },
      { code: "610000", name: "Operating Expenses", accountType: "OPEX", defaultAssetClass: null },
    ])
    .returning();

  const fiscalYear = new Date().getFullYear();
  await db.insert(fiscalLimits).values([
    {
      costCenterId: plant.id,
      glAccountId: aucPlant.id,
      fiscalYear,
      maxSingleRequestAmount: "5000000.00",
      maxAnnualAmount: "20000000.00",
      currency: "EGP",
    },
    {
      costCenterId: it.id,
      glAccountId: aucIt.id,
      fiscalYear,
      maxSingleRequestAmount: "1000000.00",
      maxAnnualAmount: "3000000.00",
      currency: "EGP",
    },
    {
      costCenterId: plant.id,
      glAccountId: opex.id,
      fiscalYear,
      maxSingleRequestAmount: "200000.00",
      maxAnnualAmount: "800000.00",
      currency: "EGP",
    },
  ]);

  // Org chart: CFO is the Finance Controller, no manager above.
  const [cfo] = await db
    .insert(users)
    .values({
      employeeId: "EMP-001",
      name: "Mona Farid",
      email: "mona.farid@citycement.example",
      role: "FINANCE_CONTROLLER",
      department: "Finance",
      costCenterId: finance.id,
      managerId: null,
    })
    .returning();

  const [opsDeptHead] = await db
    .insert(users)
    .values({
      employeeId: "EMP-002",
      name: "Karim Adel",
      email: "karim.adel@citycement.example",
      role: "DEPARTMENT_HEAD",
      department: "Operations",
      costCenterId: plant.id,
      managerId: cfo.id,
    })
    .returning();

  const [itDeptHead] = await db
    .insert(users)
    .values({
      employeeId: "EMP-003",
      name: "Nadia Hassan",
      email: "nadia.hassan@citycement.example",
      role: "DEPARTMENT_HEAD",
      department: "Information Technology",
      costCenterId: it.id,
      managerId: cfo.id,
    })
    .returning();

  const [plantLineManager] = await db
    .insert(users)
    .values({
      employeeId: "EMP-004",
      name: "Tarek Mahmoud",
      email: "tarek.mahmoud@citycement.example",
      role: "LINE_MANAGER",
      department: "Operations",
      costCenterId: plant.id,
      managerId: opsDeptHead.id,
    })
    .returning();

  const [itLineManager] = await db
    .insert(users)
    .values({
      employeeId: "EMP-005",
      name: "Sara Younis",
      email: "sara.younis@citycement.example",
      role: "LINE_MANAGER",
      department: "Information Technology",
      costCenterId: it.id,
      managerId: itDeptHead.id,
    })
    .returning();

  await db.insert(users).values([
    {
      employeeId: "EMP-006",
      name: "Ahmed Said",
      email: "ahmed.said@citycement.example",
      role: "REQUESTOR",
      department: "Operations",
      costCenterId: plant.id,
      managerId: plantLineManager.id,
    },
    {
      employeeId: "EMP-007",
      name: "Laila Mostafa",
      email: "laila.mostafa@citycement.example",
      role: "REQUESTOR",
      department: "Information Technology",
      costCenterId: it.id,
      managerId: itLineManager.id,
    },
    {
      employeeId: "EMP-000",
      name: "System Admin",
      email: "admin@citycement.example",
      role: "ADMIN",
      department: "IT",
      costCenterId: it.id,
      managerId: null,
    },
  ]);

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
