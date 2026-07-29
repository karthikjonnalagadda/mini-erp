/**
 * Database seed.
 *
 * Produces a dataset a reviewer can log into and immediately exercise every
 * feature: low-stock warnings fire, the dashboard charts have shape, drafts and
 * confirmed challans both exist, and the stock ledger reconciles.
 *
 * Two properties make this safe to re-run:
 *  1. IDEMPOTENT — everything uses `upsert` on a natural key, so running it
 *     twice does not duplicate data or crash on a unique violation.
 *  2. STOCK GOES THROUGH THE LEDGER — opening balances are posted as real
 *     StockMovement rows rather than written straight into `inventory`. A seed
 *     that fabricates stock silently would leave the seeded database in a state
 *     the application itself could never produce.
 *
 * Run with:  npm run db:seed
 */
import { PrismaClient, Prisma } from '@prisma/client';
import type { RoleName } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Deterministic pseudo-random so repeated seeds produce identical data. */
let seedCursor = 42;
const nextRandom = (): number => {
  seedCursor = (seedCursor * 1103515245 + 12345) % 2147483648;
  return seedCursor / 2147483648;
};
const randomInt = (min: number, max: number): number =>
  Math.floor(nextRandom() * (max - min + 1)) + min;
const pick = <T>(items: readonly T[]): T => items[randomInt(0, items.length - 1)] as T;
const daysAgo = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const daysAhead = (days: number): Date => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const ROLE_DEFINITIONS: Array<{ name: RoleName; description: string }> = [
  { name: 'ADMIN', description: 'Full system access including user administration' },
  { name: 'SALES', description: 'Manages customers and raises sales challans' },
  { name: 'WAREHOUSE', description: 'Manages catalogue, inventory and challan dispatch' },
  { name: 'ACCOUNTS', description: 'Read-only operations access plus challan cancellation' },
];

async function seedRoles(): Promise<Map<RoleName, string>> {
  const roleIds = new Map<RoleName, string>();

  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { name: definition.name },
      update: { description: definition.description },
      create: { name: definition.name, description: definition.description, isSystem: true },
    });
    roleIds.set(definition.name, role.id);
  }

  console.log(`  roles ................ ${roleIds.size}`);
  return roleIds;
}

async function seedUsers(roleIds: Map<RoleName, string>): Promise<Map<string, string>> {
  const adminEmail = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@erpportal.io';
  const adminPassword = process.env['SEED_ADMIN_PASSWORD'] ?? 'Admin@12345';

  // Hash once and reuse: bcrypt at cost 12 takes ~250ms, and hashing six
  // passwords separately would add a needless second and a half to every seed.
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const users = [
    { email: adminEmail, firstName: 'Aarav', lastName: 'Sharma', role: 'ADMIN' as RoleName, phone: '9820011223' },
    { email: 'sales@erpportal.io', firstName: 'Priya', lastName: 'Nair', role: 'SALES' as RoleName, phone: '9820011224' },
    { email: 'sales2@erpportal.io', firstName: 'Rohan', lastName: 'Mehta', role: 'SALES' as RoleName, phone: '9820011225' },
    { email: 'warehouse@erpportal.io', firstName: 'Imran', lastName: 'Qureshi', role: 'WAREHOUSE' as RoleName, phone: '9820011226' },
    { email: 'accounts@erpportal.io', firstName: 'Neha', lastName: 'Kulkarni', role: 'ACCOUNTS' as RoleName, phone: '9820011227' },
  ];

  const userIds = new Map<string, string>();

  for (const definition of users) {
    const roleId = roleIds.get(definition.role);
    if (!roleId) throw new Error(`Missing role ${definition.role}`);

    const user = await prisma.user.upsert({
      where: { email: definition.email },
      update: { firstName: definition.firstName, lastName: definition.lastName, roleId },
      create: {
        email: definition.email,
        passwordHash,
        firstName: definition.firstName,
        lastName: definition.lastName,
        phone: definition.phone,
        status: 'ACTIVE',
        roleId,
        lastLoginAt: daysAgo(randomInt(0, 5)),
      },
    });
    userIds.set(definition.role === 'SALES' ? definition.email : definition.role, user.id);
    userIds.set(definition.email, user.id);
  }

  console.log(`  users ................ ${users.length}  (password for all: ${adminPassword})`);
  return userIds;
}

async function seedCategories(): Promise<Map<string, string>> {
  const categories = [
    { name: 'Electrical', slug: 'electrical', description: 'Wiring, switchgear and accessories' },
    { name: 'Plumbing', slug: 'plumbing', description: 'Pipes, fittings and sanitary ware' },
    { name: 'Hardware', slug: 'hardware', description: 'Fasteners, tools and fixings' },
    { name: 'Paints & Chemicals', slug: 'paints-chemicals', description: 'Coatings, adhesives and solvents' },
    { name: 'Safety Equipment', slug: 'safety-equipment', description: 'PPE and site safety supplies' },
  ];

  const categoryIds = new Map<string, string>();

  for (const definition of categories) {
    const category = await prisma.category.upsert({
      where: { name: definition.name },
      update: { description: definition.description },
      create: { ...definition, isActive: true },
    });
    categoryIds.set(definition.slug, category.id);
  }

  console.log(`  categories ........... ${categories.length}`);
  return categoryIds;
}

interface ProductSeed {
  sku: string;
  name: string;
  category: string;
  unitPrice: number;
  costPrice: number;
  taxRate: number;
  unit: string;
  minimumStock: number;
  openingStock: number;
  warehouseLocation: string;
}

/**
 * Opening stock is chosen deliberately so the seeded system demonstrates every
 * stock state: some products sit below their minimum (LOW_STOCK), one is at
 * zero (OUT_OF_STOCK), the rest are healthy.
 */
const PRODUCT_SEEDS: ProductSeed[] = [
  { sku: 'ELE-WIR-1SQ', name: 'Copper Wire 1.0 sq mm (90m coil)', category: 'electrical', unitPrice: 1285, costPrice: 1040, taxRate: 18, unit: 'PCS', minimumStock: 25, openingStock: 140, warehouseLocation: 'WH-A' },
  { sku: 'ELE-WIR-25SQ', name: 'Copper Wire 2.5 sq mm (90m coil)', category: 'electrical', unitPrice: 2870, costPrice: 2390, taxRate: 18, unit: 'PCS', minimumStock: 20, openingStock: 12, warehouseLocation: 'WH-A' },
  { sku: 'ELE-MCB-32A', name: 'MCB Single Pole 32A C-Curve', category: 'electrical', unitPrice: 268, costPrice: 198, taxRate: 18, unit: 'PCS', minimumStock: 60, openingStock: 480, warehouseLocation: 'WH-A' },
  { sku: 'ELE-SWT-16A', name: 'Modular Switch 16A', category: 'electrical', unitPrice: 148, costPrice: 96, taxRate: 18, unit: 'PCS', minimumStock: 100, openingStock: 950, warehouseLocation: 'WH-A' },
  { sku: 'ELE-LED-9W', name: 'LED Bulb 9W Cool White', category: 'electrical', unitPrice: 96, costPrice: 62, taxRate: 12, unit: 'PCS', minimumStock: 150, openingStock: 1_240, warehouseLocation: 'WH-B' },
  { sku: 'PLM-PVC-110', name: 'PVC Pipe 110mm x 3m', category: 'plumbing', unitPrice: 742, costPrice: 590, taxRate: 18, unit: 'PCS', minimumStock: 40, openingStock: 305, warehouseLocation: 'WH-B' },
  { sku: 'PLM-ELB-110', name: 'PVC Elbow 110mm 90deg', category: 'plumbing', unitPrice: 128, costPrice: 84, taxRate: 18, unit: 'PCS', minimumStock: 80, openingStock: 62, warehouseLocation: 'WH-B' },
  { sku: 'PLM-TAP-BIB', name: 'Brass Bib Cock Tap', category: 'plumbing', unitPrice: 486, costPrice: 352, taxRate: 18, unit: 'PCS', minimumStock: 30, openingStock: 218, warehouseLocation: 'WH-B' },
  { sku: 'HRD-SCR-25', name: 'Self-tapping Screw 25mm (Box 500)', category: 'hardware', unitPrice: 340, costPrice: 236, taxRate: 18, unit: 'BOX', minimumStock: 25, openingStock: 190, warehouseLocation: 'WH-C' },
  { sku: 'HRD-BLT-M10', name: 'Hex Bolt M10 x 75mm (Box 100)', category: 'hardware', unitPrice: 612, costPrice: 470, taxRate: 18, unit: 'BOX', minimumStock: 20, openingStock: 0, warehouseLocation: 'WH-C' },
  { sku: 'HRD-TAP-MSR', name: 'Measuring Tape 5m Steel', category: 'hardware', unitPrice: 218, costPrice: 148, taxRate: 18, unit: 'PCS', minimumStock: 40, openingStock: 176, warehouseLocation: 'WH-C' },
  { sku: 'PNT-EMU-20L', name: 'Interior Emulsion Paint 20L', category: 'paints-chemicals', unitPrice: 4_180, costPrice: 3_420, taxRate: 18, unit: 'PCS', minimumStock: 15, openingStock: 84, warehouseLocation: 'WH-D' },
  { sku: 'PNT-PRM-10L', name: 'Wall Primer 10L', category: 'paints-chemicals', unitPrice: 1_760, costPrice: 1_380, taxRate: 18, unit: 'PCS', minimumStock: 20, openingStock: 17, warehouseLocation: 'WH-D' },
  { sku: 'PNT-ADH-5KG', name: 'Tile Adhesive 5kg', category: 'paints-chemicals', unitPrice: 428, costPrice: 312, taxRate: 18, unit: 'PKT', minimumStock: 50, openingStock: 412, warehouseLocation: 'WH-D' },
  { sku: 'SAF-HLM-STD', name: 'Safety Helmet ISI Marked', category: 'safety-equipment', unitPrice: 296, costPrice: 198, taxRate: 18, unit: 'PCS', minimumStock: 50, openingStock: 340, warehouseLocation: 'WH-C' },
  { sku: 'SAF-GLV-NIT', name: 'Nitrile Safety Gloves (Pair)', category: 'safety-equipment', unitPrice: 84, costPrice: 52, taxRate: 12, unit: 'PCS', minimumStock: 120, openingStock: 96, warehouseLocation: 'WH-C' },
];

async function seedProducts(
  categoryIds: Map<string, string>,
  warehouseUserId: string,
): Promise<Map<string, { id: string; unitPrice: number; taxRate: number; unit: string }>> {
  const productIds = new Map<string, { id: string; unitPrice: number; taxRate: number; unit: string }>();

  for (const definition of PRODUCT_SEEDS) {
    const categoryId = categoryIds.get(definition.category);
    if (!categoryId) throw new Error(`Missing category ${definition.category}`);

    const product = await prisma.product.upsert({
      where: { sku: definition.sku },
      update: {
        name: definition.name,
        unitPrice: new Prisma.Decimal(definition.unitPrice),
        costPrice: new Prisma.Decimal(definition.costPrice),
        minimumStock: definition.minimumStock,
      },
      create: {
        sku: definition.sku,
        name: definition.name,
        categoryId,
        unitPrice: new Prisma.Decimal(definition.unitPrice),
        costPrice: new Prisma.Decimal(definition.costPrice),
        taxRate: new Prisma.Decimal(definition.taxRate),
        unit: definition.unit,
        minimumStock: definition.minimumStock,
        isActive: true,
        inventory: {
          create: {
            quantityOnHand: 0,
            warehouseLocation: definition.warehouseLocation,
          },
        },
      },
    });

    productIds.set(definition.sku, {
      id: product.id,
      unitPrice: definition.unitPrice,
      taxRate: definition.taxRate,
      unit: definition.unit,
    });

    // Post the opening balance through the ledger, exactly as the application
    // would. Skipped on re-runs so the seed stays idempotent.
    const alreadyOpened = await prisma.stockMovement.findFirst({
      where: { productId: product.id, reason: 'OPENING_BALANCE' },
      select: { id: true },
    });

    if (!alreadyOpened && definition.openingStock > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.inventory.update({
          where: { productId: product.id },
          data: {
            quantityOnHand: { increment: definition.openingStock },
            version: { increment: 1 },
            lastMovementAt: daysAgo(60),
          },
        });
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            movementType: 'IN',
            reason: 'OPENING_BALANCE',
            quantity: definition.openingStock,
            quantityBefore: 0,
            quantityAfter: definition.openingStock,
            referenceType: 'OPENING',
            notes: 'Opening balance loaded during system setup',
            createdById: warehouseUserId,
            createdAt: daysAgo(60),
          },
        });
      });
    }
  }

  console.log(`  products ............. ${PRODUCT_SEEDS.length} (with opening-balance movements)`);
  return productIds;
}

interface CustomerSeed {
  code: string;
  name: string;
  businessName: string;
  email: string;
  mobile: string;
  gstNumber: string;
  customerType: 'RETAILER' | 'WHOLESALER' | 'DISTRIBUTOR' | 'CORPORATE' | 'WALK_IN';
  status: 'LEAD' | 'ACTIVE' | 'INACTIVE' | 'BLACKLISTED';
  city: string;
  state: string;
  postalCode: string;
  creditLimit: number;
}

const CUSTOMER_SEEDS: CustomerSeed[] = [
  { code: 'CUST-000001', name: 'Suresh Patil', businessName: 'Patil Electricals', email: 'suresh@patilelectricals.in', mobile: '9822014455', gstNumber: '27AAPFU0939F1ZV', customerType: 'RETAILER', status: 'ACTIVE', city: 'Pune', state: 'Maharashtra', postalCode: '411001', creditLimit: 250000 },
  { code: 'CUST-000002', name: 'Meena Iyer', businessName: 'Iyer Hardware Mart', email: 'meena@iyerhardware.in', mobile: '9845067788', gstNumber: '29AACCI1234M1Z8', customerType: 'WHOLESALER', status: 'ACTIVE', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', creditLimit: 800000 },
  { code: 'CUST-000003', name: 'Vikram Singh', businessName: 'Singh Distributors Pvt Ltd', email: 'vikram@singhdist.in', mobile: '9811223344', gstNumber: '07AABCS4321Q1ZK', customerType: 'DISTRIBUTOR', status: 'ACTIVE', city: 'New Delhi', state: 'Delhi', postalCode: '110001', creditLimit: 1500000 },
  { code: 'CUST-000004', name: 'Anita Desai', businessName: 'Desai Constructions', email: 'anita@desaiconstructions.in', mobile: '9833445566', gstNumber: '27AADCD9876R1Z2', customerType: 'CORPORATE', status: 'ACTIVE', city: 'Mumbai', state: 'Maharashtra', postalCode: '400001', creditLimit: 2000000 },
  { code: 'CUST-000005', name: 'Ravi Kumar', businessName: 'Kumar Traders', email: 'ravi@kumartraders.in', mobile: '9840112233', gstNumber: '33AAJCK5678N1Z9', customerType: 'RETAILER', status: 'LEAD', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001', creditLimit: 100000 },
  { code: 'CUST-000006', name: 'Farhan Sheikh', businessName: 'Sheikh Sanitary House', email: 'farhan@sheikhsanitary.in', mobile: '9890223344', gstNumber: '27AAFFS2345L1ZQ', customerType: 'RETAILER', status: 'ACTIVE', city: 'Nagpur', state: 'Maharashtra', postalCode: '440001', creditLimit: 180000 },
  { code: 'CUST-000007', name: 'Deepa Menon', businessName: 'Menon Builders', email: 'deepa@menonbuilders.in', mobile: '9847556677', gstNumber: '32AAECM8765P1ZR', customerType: 'CORPORATE', status: 'LEAD', city: 'Kochi', state: 'Kerala', postalCode: '682001', creditLimit: 500000 },
  { code: 'CUST-000008', name: 'Ashok Gupta', businessName: 'Gupta Paint Centre', email: 'ashok@guptapaints.in', mobile: '9812334455', gstNumber: '09AAGCG3456T1ZM', customerType: 'RETAILER', status: 'INACTIVE', city: 'Lucknow', state: 'Uttar Pradesh', postalCode: '226001', creditLimit: 90000 },
  { code: 'CUST-000009', name: 'Kavita Joshi', businessName: 'Joshi Enterprises', email: 'kavita@joshient.in', mobile: '9823667788', gstNumber: '27AAHCJ6543K1ZW', customerType: 'WHOLESALER', status: 'ACTIVE', city: 'Nashik', state: 'Maharashtra', postalCode: '422001', creditLimit: 650000 },
  { code: 'CUST-000010', name: 'Sanjay Rao', businessName: 'Rao Electricals & Co', email: 'sanjay@raoelectricals.in', mobile: '9844778899', gstNumber: '29AAKCR7890B1ZX', customerType: 'RETAILER', status: 'BLACKLISTED', city: 'Mysuru', state: 'Karnataka', postalCode: '570001', creditLimit: 0 },
];

async function seedCustomers(salesUserIds: string[]): Promise<Map<string, string>> {
  const customerIds = new Map<string, string>();

  for (const [index, definition] of CUSTOMER_SEEDS.entries()) {
    const ownerId = salesUserIds[index % salesUserIds.length] ?? salesUserIds[0];

    const customer = await prisma.customer.upsert({
      where: { code: definition.code },
      update: { name: definition.name, status: definition.status },
      create: {
        code: definition.code,
        name: definition.name,
        businessName: definition.businessName,
        email: definition.email,
        mobile: definition.mobile,
        gstNumber: definition.gstNumber,
        customerType: definition.customerType,
        status: definition.status,
        addressLine1: `${randomInt(10, 990)}, ${pick(['MG Road', 'Station Road', 'Industrial Estate', 'Market Yard'])}`,
        city: definition.city,
        state: definition.state,
        postalCode: definition.postalCode,
        country: 'India',
        creditLimit: new Prisma.Decimal(definition.creditLimit),
        notes: 'Imported during initial system setup.',
        ownerId: ownerId ?? null,
        createdAt: daysAgo(randomInt(20, 200)),
      },
    });

    customerIds.set(definition.code, customer.id);
  }

  // Keep the customer sequence ahead of the seeded codes so the first
  // application-created customer does not collide with CUST-000010.
  await prisma.documentSequence.upsert({
    where: { key: 'CUSTOMER:0' },
    update: { currentValue: CUSTOMER_SEEDS.length },
    create: { key: 'CUSTOMER:0', prefix: 'CUST', currentValue: CUSTOMER_SEEDS.length, padding: 6 },
  });

  console.log(`  customers ............ ${CUSTOMER_SEEDS.length}`);
  return customerIds;
}

async function seedFollowUps(
  customerIds: Map<string, string>,
  salesUserId: string,
): Promise<void> {
  const existing = await prisma.customerFollowUp.count();
  if (existing > 0) {
    console.log(`  follow-ups ........... skipped (${existing} already present)`);
    return;
  }

  const templates = [
    { type: 'CALL' as const, subject: 'Quarterly requirement discussion', offset: 3 },
    { type: 'MEETING' as const, subject: 'Site visit for bulk order', offset: 7 },
    { type: 'EMAIL' as const, subject: 'Share updated rate card', offset: -4 },
    { type: 'WHATSAPP' as const, subject: 'Confirm dispatch schedule', offset: -1 },
    { type: 'SITE_VISIT' as const, subject: 'Inspect delivered material', offset: 12 },
  ];

  let created = 0;
  for (const [code, customerId] of customerIds) {
    // Two activities each for the first six accounts — enough to make the
    // timeline and the "due today" filter meaningful without bloating the seed.
    if (created >= 12) break;
    void code;

    for (const template of templates.slice(0, 2)) {
      const scheduledAt =
        template.offset >= 0 ? daysAhead(template.offset + randomInt(0, 4)) : daysAgo(-template.offset);
      const isPast = scheduledAt.getTime() < Date.now();

      await prisma.customerFollowUp.create({
        data: {
          customerId,
          type: template.type,
          status: isPast ? 'OVERDUE' : 'PENDING',
          subject: template.subject,
          notes: 'Auto-generated during seeding.',
          scheduledAt,
          createdById: salesUserId,
        },
      });
      created += 1;
    }
  }

  // Refresh each customer's cached next-follow-up date, mirroring what the
  // service does on every follow-up write.
  for (const customerId of customerIds.values()) {
    const next = await prisma.customerFollowUp.findFirst({
      where: { customerId, status: { in: ['PENDING', 'OVERDUE'] } },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true },
    });
    await prisma.customer.update({
      where: { id: customerId },
      data: { followUpDate: next?.scheduledAt ?? null },
    });
  }

  console.log(`  follow-ups ........... ${created}`);
}

async function seedChallans(
  customerIds: Map<string, string>,
  productIds: Map<string, { id: string; unitPrice: number; taxRate: number; unit: string }>,
  users: { sales: string; warehouse: string; accounts: string },
): Promise<void> {
  const existing = await prisma.salesChallan.count();
  if (existing > 0) {
    console.log(`  challans ............. skipped (${existing} already present)`);
    return;
  }

  const year = new Date().getFullYear();
  const sellableSkus = PRODUCT_SEEDS.filter((p) => p.openingStock > 60).map((p) => p.sku);
  const activeCustomerCodes = CUSTOMER_SEEDS.filter((c) => c.status === 'ACTIVE').map((c) => c.code);

  /** DRAFT / CONFIRMED / CANCELLED mix so every UI state is represented. */
  const plan: Array<{ status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED'; count: number }> = [
    { status: 'CONFIRMED', count: 10 },
    { status: 'DRAFT', count: 3 },
    { status: 'CANCELLED', count: 2 },
  ];

  let sequence = 0;

  for (const group of plan) {
    for (let index = 0; index < group.count; index += 1) {
      sequence += 1;
      const challanNumber = `CH-${year}-${String(sequence).padStart(6, '0')}`;
      const customerCode = activeCustomerCodes[sequence % activeCustomerCodes.length] as string;
      const customerId = customerIds.get(customerCode);
      if (!customerId) continue;

      // 1-3 distinct lines per challan.
      const lineSkus = [...new Set(Array.from({ length: randomInt(1, 3) }, () => pick(sellableSkus)))];

      let subtotal = 0;
      let discountTotal = 0;
      let taxTotal = 0;

      const items = lineSkus.map((sku) => {
        const product = productIds.get(sku);
        const seed = PRODUCT_SEEDS.find((p) => p.sku === sku);
        if (!product || !seed) throw new Error(`Missing product ${sku}`);

        const quantity = randomInt(2, 14);
        const discountPercent = pick([0, 0, 2.5, 5]);
        const gross = product.unitPrice * quantity;
        const discount = Math.round(gross * (discountPercent / 100) * 100) / 100;
        const net = gross - discount;
        const tax = Math.round(net * (product.taxRate / 100) * 100) / 100;

        subtotal += gross;
        discountTotal += discount;
        taxTotal += tax;

        return {
          productId: product.id,
          productSku: sku,
          productName: seed.name,
          unit: product.unit,
          unitPrice: new Prisma.Decimal(product.unitPrice),
          taxRate: new Prisma.Decimal(product.taxRate),
          quantity,
          discountPercent: new Prisma.Decimal(discountPercent),
          lineSubtotal: new Prisma.Decimal(net),
          lineTaxAmount: new Prisma.Decimal(tax),
          lineTotal: new Prisma.Decimal(net + tax),
        };
      });

      const totalAmount = subtotal - discountTotal + taxTotal;
      const challanDate = daysAgo(randomInt(1, 45));
      const isConfirmed = group.status === 'CONFIRMED';
      const isCancelled = group.status === 'CANCELLED';

      await prisma.$transaction(async (tx) => {
        const challan = await tx.salesChallan.create({
          data: {
            challanNumber,
            status: group.status,
            customerId,
            challanDate,
            dispatchDate: isConfirmed ? challanDate : null,
            subtotal: new Prisma.Decimal(subtotal),
            discountAmount: new Prisma.Decimal(discountTotal),
            taxAmount: new Prisma.Decimal(taxTotal),
            totalAmount: new Prisma.Decimal(totalAmount),
            transporterName: isConfirmed ? pick(['VRL Logistics', 'TCI Express', 'Gati']) : null,
            vehicleNumber: isConfirmed ? `MH${randomInt(10, 48)}AB${randomInt(1000, 9999)}` : null,
            notes: 'Generated during seeding.',
            createdById: users.sales,
            // The CHECK constraints added in the integrity migration require
            // this metadata whenever the status is CONFIRMED or CANCELLED.
            confirmedById: isConfirmed ? users.warehouse : null,
            confirmedAt: isConfirmed ? challanDate : null,
            cancelledById: isCancelled ? users.accounts : null,
            cancelledAt: isCancelled ? challanDate : null,
            cancellationReason: isCancelled ? 'Customer revised the order before dispatch' : null,
            createdAt: challanDate,
            items: { createMany: { data: items } },
          },
        });

        // Only CONFIRMED challans moved stock, so only they get ledger rows.
        if (isConfirmed) {
          for (const item of items) {
            const inventory = await tx.inventory.findUnique({
              where: { productId: item.productId },
              select: { quantityOnHand: true },
            });
            const before = inventory?.quantityOnHand ?? 0;
            // Never drive a seeded product negative — the CHECK constraint
            // would reject it, and a seed that fights its own schema is a bug.
            const quantity = Math.min(item.quantity, before);
            if (quantity <= 0) continue;

            await tx.inventory.update({
              where: { productId: item.productId },
              data: {
                quantityOnHand: { decrement: quantity },
                version: { increment: 1 },
                lastMovementAt: challanDate,
              },
            });

            await tx.stockMovement.create({
              data: {
                productId: item.productId,
                movementType: 'OUT',
                reason: 'SALES_CHALLAN',
                quantity,
                quantityBefore: before,
                quantityAfter: before - quantity,
                referenceType: 'SALES_CHALLAN',
                referenceId: challan.id,
                referenceCode: challanNumber,
                notes: `Dispatched on challan ${challanNumber}`,
                createdById: users.warehouse,
                createdAt: challanDate,
              },
            });
          }

          await tx.customer.update({
            where: { id: customerId },
            data: { outstandingAmount: { increment: new Prisma.Decimal(totalAmount) } },
          });

          await tx.auditLog.create({
            data: {
              action: 'CHALLAN_CONFIRM',
              entityType: 'SalesChallan',
              entityId: challan.id,
              summary: `Confirmed challan ${challanNumber}`,
              actorEmail: 'warehouse@erpportal.io',
              actorRole: 'WAREHOUSE',
              createdAt: challanDate,
            },
          });
        }
      });
    }
  }

  // Advance the challan sequence past the seeded numbers.
  await prisma.documentSequence.upsert({
    where: { key: `SALES_CHALLAN:${year}` },
    update: { currentValue: sequence },
    create: { key: `SALES_CHALLAN:${year}`, prefix: 'CH', currentValue: sequence, padding: 6 },
  });

  console.log(`  challans ............. ${sequence} (10 confirmed, 3 draft, 2 cancelled)`);
}

async function main(): Promise<void> {
  console.log('\nSeeding Mini ERP + CRM database\n');

  const roleIds = await seedRoles();
  const userIds = await seedUsers(roleIds);

  const adminId = userIds.get('ADMIN');
  const warehouseId = userIds.get('WAREHOUSE');
  const accountsId = userIds.get('ACCOUNTS');
  const salesId = userIds.get('sales@erpportal.io');
  const sales2Id = userIds.get('sales2@erpportal.io');

  if (!adminId || !warehouseId || !accountsId || !salesId || !sales2Id) {
    throw new Error('Seed failed: expected users were not created');
  }

  const categoryIds = await seedCategories();
  const productIds = await seedProducts(categoryIds, warehouseId);
  const customerIds = await seedCustomers([salesId, sales2Id]);
  await seedFollowUps(customerIds, salesId);
  await seedChallans(customerIds, productIds, {
    sales: salesId,
    warehouse: warehouseId,
    accounts: accountsId,
  });

  console.log('\nSeed complete. Sign in with:');
  for (const definition of [
    ['ADMIN    ', process.env['SEED_ADMIN_EMAIL'] ?? 'admin@erpportal.io'],
    ['SALES    ', 'sales@erpportal.io'],
    ['WAREHOUSE', 'warehouse@erpportal.io'],
    ['ACCOUNTS ', 'accounts@erpportal.io'],
  ]) {
    console.log(`  ${definition[0]}  ${definition[1]}`);
  }
  console.log(`  password   ${process.env['SEED_ADMIN_PASSWORD'] ?? 'Admin@12345'}\n`);
}

main()
  .catch((error: unknown) => {
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
