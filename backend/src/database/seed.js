const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const pool = require('../config/database');

const TENANT_ID = '262467ed-7cf3-418b-b46c-6038540f9260';

const seed = async () => {
  console.log('Seeding demo data...');

  try {
    // 1. DOCTORS
    const doctorsToEnsure = [
      {
        name: 'Dr. Rajan Kumar',
        specialization: 'General Medicine',
        phone: '9847000001',
        qualification: 'MBBS, MD',
        max_tokens_daily: 30,
        consultation_fee: 300
      },
      {
        name: 'Dr. Priya Menon',
        specialization: 'Gynaecology',
        phone: '9847000002',
        qualification: 'MS OBG',
        max_tokens_daily: 25,
        consultation_fee: 400
      },
      {
        name: 'Dr. Suresh Nair',
        specialization: 'Orthopaedics',
        phone: '9847000003',
        qualification: 'MS Ortho',
        max_tokens_daily: 20,
        consultation_fee: 500
      }
    ];

    const doctorIds = {}; // map of name -> id

    for (const doc of doctorsToEnsure) {
      const existing = await pool.query(
        'SELECT id FROM clinic_doctors WHERE tenant_id = $1 AND name = $2 LIMIT 1',
        [TENANT_ID, doc.name]
      );

      if (existing.rows.length > 0) {
        doctorIds[doc.name] = existing.rows[0].id;
      } else {
        const insert = await pool.query(
          `INSERT INTO clinic_doctors 
           (tenant_id, name, specialization, phone, qualification, max_tokens_daily, consultation_fee) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [TENANT_ID, doc.name, doc.specialization, doc.phone, doc.qualification, doc.max_tokens_daily, doc.consultation_fee]
        );
        doctorIds[doc.name] = insert.rows[0].id;
      }
    }
    console.log('✅ Doctors seeded');

    // 2. CUSTOMERS
    const customers = [
      { name: 'Anjali Thomas', phone: '9847111001' },
      { name: 'Mohammed Riyas', phone: '9847111002' },
      { name: 'Lakshmi Devi', phone: '9847111003' },
      { name: 'Arjun Krishna', phone: '9847111004' },
      { name: 'Meera Pillai', phone: '9847111005' },
    ];

    const customerIds = {};

    for (const cus of customers) {
      // checking by unique constraint unique(tenant_id, phone)
      const existing = await pool.query(
        'SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1',
        [TENANT_ID, cus.phone]
      );

      if (existing.rows.length > 0) {
        customerIds[cus.phone] = existing.rows[0].id;
      } else {
        const insert = await pool.query(
          `INSERT INTO customers (tenant_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
          [TENANT_ID, cus.name, cus.phone]
        );
        customerIds[cus.phone] = insert.rows[0].id;
      }
    }
    console.log('✅ Customers seeded');

    // 3. CONVERSATIONS & MESSAGES
    // Create 3 static UUIDs for conversations to easily re-run `ON CONFLICT DO NOTHING`
    const convIds = [
      'c0000000-0000-0000-0000-000000000001',
      'c0000000-0000-0000-0000-000000000002',
      'c0000000-0000-0000-0000-000000000003'
    ];

    const customerPhonesForConv = ['9847111001', '9847111002', '9847111003'];

    for (let i = 0; i < 3; i++) {
        const cusId = customerIds[customerPhonesForConv[i]];
        const cId = convIds[i];

        await pool.query(
            `INSERT INTO conversations (id, tenant_id, customer_id, channel, status)
             VALUES ($1, $2, $3, 'whatsapp', 'active')
             ON CONFLICT (id) DO NOTHING`,
             [cId, TENANT_ID, cusId]
        );

        // check if empty
        const msgs = await pool.query('SELECT id FROM messages WHERE conversation_id = $1 LIMIT 1', [cId]);
        if (msgs.rows.length === 0) {
            // patient msg
            await pool.query(
                `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
                [cId, 'Hello, I want an appointment today.']
            );
            // ai reply
            await pool.query(
                `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
                [cId, 'Hello! I can help with that. Which doctor would you like to consult?']
            );
        }
    }
    console.log('✅ Conversations seeded');

    // 4. BOOKINGS
    // Fixed UUIDs for 10 bookings
    const docNames = ['Dr. Rajan Kumar', 'Dr. Priya Menon', 'Dr. Suresh Nair', 'Dr. Rajan Kumar', 'Dr. Priya Menon', 'Dr. Suresh Nair', 'Dr. Rajan Kumar', 'Dr. Priya Menon', 'Dr. Suresh Nair', 'Dr. Rajan Kumar'];
    const cusPhones = ['9847111001', '9847111002', '9847111003', '9847111004', '9847111005', '9847111001', '9847111002', '9847111003', '9847111004', '9847111005'];
    const statuses = ['completed', 'completed', 'cancelled', 'confirmed', 'pending', 'confirmed', 'pending', 'noshow', 'confirmed', 'pending'];
    const sources = ['whatsapp', 'walkin', 'whatsapp', 'walkin', 'whatsapp', 'walkin', 'whatsapp', 'whatsapp', 'walkin', 'whatsapp'];

    for (let i = 0; i < 10; i++) {
      const bId = `b0000000-0000-0000-0000-0000000000` + (i < 9 ? `0${i+1}` : `10`);
      const docId = doctorIds[docNames[i]];
      const cusId = customerIds[cusPhones[i]];
      const today = new Date();
      if (i < 3) today.setDate(today.getDate() - 1); // some yesterday
      const dateStr = today.toISOString().split('T')[0];
      
      await pool.query(
        `INSERT INTO bookings (id, tenant_id, customer_id, doctor_id, source, status, booking_date, token_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [bId, TENANT_ID, cusId, docId, sources[i], statuses[i], dateStr, i + 1]
      );
    }
    console.log('✅ Bookings seeded');

    console.log('✅ Demo data complete');
    process.exit(0);

  } catch (error) {
    console.error('Error seeding demo data:', error);
    process.exit(1);
  }
};

seed();
