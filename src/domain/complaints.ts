import { desc, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { complaints as complaintsTable } from '../db/schema.js';

export type ComplaintCategory = 'LATE_DELIVERY' | 'WRONG_ITEM' | 'MISSING_ITEM' | 'FOOD_QUALITY' | 'OTHER';
export type ComplaintStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED';

export interface Complaint {
  id: string;
  phone: string;
  orderId: string;
  category: ComplaintCategory;
  description: string | null;
  status: ComplaintStatus;
  createdAt: number;
}

export function generateComplaintId(now: number): string {
  const stamp = now.toString(36).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `C-${stamp}-${suffix}`;
}

// Local-file mode has no complaints fixture (this feature has no seed data to
// predate) - an in-memory list is enough for local dev/tests, matching how
// added_users.json exists only because that feature needed seed data too.
const localComplaints: Complaint[] = [];

export interface CreateComplaintInput {
  phone: string;
  orderId: string;
  category: ComplaintCategory;
  description?: string | null;
  now?: number;
}

export async function createComplaint(input: CreateComplaintInput): Promise<Complaint> {
  const now = input.now ?? Date.now();
  const complaint: Complaint = {
    id: generateComplaintId(now),
    phone: input.phone,
    orderId: input.orderId,
    category: input.category,
    description: input.description?.trim() || null,
    status: 'OPEN',
    createdAt: now,
  };

  const db = getDb();
  if (db) {
    await db.insert(complaintsTable).values({
      id: complaint.id,
      phone: complaint.phone,
      orderId: complaint.orderId,
      category: complaint.category,
      description: complaint.description,
      status: complaint.status,
      createdAt: new Date(complaint.createdAt),
    });
    return complaint;
  }

  localComplaints.unshift(complaint);
  return complaint;
}

export async function getComplaintsForUser(phone: string): Promise<Complaint[]> {
  const db = getDb();
  if (db) {
    const rows = await db
      .select()
      .from(complaintsTable)
      .where(eq(complaintsTable.phone, phone))
      .orderBy(desc(complaintsTable.createdAt));
    return rows.map((row) => ({
      id: row.id,
      phone: row.phone,
      orderId: row.orderId,
      category: row.category,
      description: row.description,
      status: row.status,
      createdAt: row.createdAt.getTime(),
    }));
  }

  return localComplaints.filter((c) => c.phone === phone);
}
