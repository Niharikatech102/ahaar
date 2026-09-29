import { describe, expect, it } from 'vitest';
import { createComplaint, generateComplaintId, getComplaintsForUser } from '../src/domain/complaints.js';

describe('generateComplaintId', () => {
  it('produces distinct ids for two calls at different times', () => {
    const a = generateComplaintId(1_700_000_000_000);
    const b = generateComplaintId(1_700_000_000_001);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^C-/);
  });
});

describe('createComplaint / getComplaintsForUser (local-file mode fallback)', () => {
  it('creates a complaint with status OPEN and returns it for the filing user', async () => {
    const phone = `whatsapp:+1999${Date.now()}`;
    const complaint = await createComplaint({
      phone,
      orderId: 'ORD-TEST-0001',
      category: 'LATE_DELIVERY',
      description: 'Took over an hour',
      now: 1_700_000_000_000,
    });

    expect(complaint.status).toBe('OPEN');
    expect(complaint.orderId).toBe('ORD-TEST-0001');
    expect(complaint.category).toBe('LATE_DELIVERY');
    expect(complaint.description).toBe('Took over an hour');

    const listed = await getComplaintsForUser(phone);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(complaint.id);
  });

  it('trims a blank description down to null rather than storing whitespace', async () => {
    const phone = `whatsapp:+1999${Date.now()}`;
    const complaint = await createComplaint({
      phone,
      orderId: 'ORD-TEST-0002',
      category: 'OTHER',
      description: '   ',
    });
    expect(complaint.description).toBeNull();
  });

  it('only returns complaints belonging to the requesting phone', async () => {
    const phoneA = `whatsapp:+1999${Date.now()}A`;
    const phoneB = `whatsapp:+1999${Date.now()}B`;
    await createComplaint({ phone: phoneA, orderId: 'ORD-A', category: 'WRONG_ITEM' });
    await createComplaint({ phone: phoneB, orderId: 'ORD-B', category: 'MISSING_ITEM' });

    const listedA = await getComplaintsForUser(phoneA);
    expect(listedA).toHaveLength(1);
    expect(listedA[0]!.orderId).toBe('ORD-A');
  });

  it('lists most-recently-created complaints first', async () => {
    const phone = `whatsapp:+1999${Date.now()}`;
    const first = await createComplaint({ phone, orderId: 'ORD-1', category: 'FOOD_QUALITY', now: 1_700_000_000_000 });
    const second = await createComplaint({ phone, orderId: 'ORD-2', category: 'FOOD_QUALITY', now: 1_700_000_001_000 });

    const listed = await getComplaintsForUser(phone);
    expect(listed[0]!.id).toBe(second.id);
    expect(listed[1]!.id).toBe(first.id);
  });
});
