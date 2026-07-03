import { Request, Response } from "express";
import { db, generateId } from "../lib/db";
import { leads, assessments, activityLogs, admins, messages as messagesTable, razorpayPayments } from "../db/schema";
import { eq, isNotNull, ilike, and, gte, lte, desc, sql } from "drizzle-orm";
import { sendWhatsAppTemplate } from "../lib/whatsapp";

export const createLead = async (req: Request, res: Response) => {
  try {
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: "Name and phone are required" });
    }

    if (name.trim().length < 2 || name.trim().length > 50) {
      return res.status(400).json({ error: "Please enter a valid name (2-50 characters)" });
    }

    let formattedPhone = phone.replace(/[^0-9]/g, "");
    
    if (formattedPhone.length === 10) {
      formattedPhone = "91" + formattedPhone;
    } else if (formattedPhone.length < 10 || formattedPhone.length > 15) {
      return res.status(400).json({ error: "Please enter a valid phone number" });
    }

    const existingLead = await db.query.leads.findFirst({
      where: eq(leads.phone, formattedPhone)
    });

    if (existingLead) {
      return res.status(409).json({ error: "Your phone number already exists in our system. Please contact us for assistance." });
    }

    const leadId = generateId();
    const [lead] = await db.insert(leads).values({
      id: leadId,
      name,
      phone: formattedPhone,
      updatedAt: new Date(),
    }).returning();

    const assessmentId = generateId();
    await db.insert(assessments).values({
      id: assessmentId,
      leadId: lead.id,
      status: "PENDING",
      currentQuestion: 0,
      updatedAt: new Date(),
    });

    await db.insert(activityLogs).values({
      id: generateId(),
      leadId: lead.id,
      action: "LEAD_CREATED",
      details: JSON.stringify({ name, phone: formattedPhone, source: "WEB_FORM" })
    });

    const welcomeText = `Hi ${name}! Thanks for joining our waitlist. Are you ready to start your quick 3-question AI assessment? Reply *YES* to begin.`;
    
    await sendWhatsAppTemplate(formattedPhone, "utl_clarity_greeting_msg", "en", [
      {
        type: "header",
        parameters: [
          { type: "text", parameter_name: "name", text: name }
        ]
      }
    ]);

    await db.insert(messagesTable).values({
      id: generateId(),
      assessmentId: assessmentId,
      role: "SYSTEM",
      content: welcomeText,
    });



    return res.json({ success: true, lead });
  } catch (error: any) {
    console.error("Lead Creation Error:", error);
    return res.status(500).json({ error: "Failed to create lead" });
  }
};

export const getDashboardData = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || "1", 10);
    const search = req.query.search as string || "";
    const status = req.query.status as string || "ALL";
    const priority = req.query.priority as string || "ALL";
    const payment = req.query.payment as string || "ALL";
    const lifecycle = req.query.lifecycle as string || "ALL";
    const startDate = req.query.startDate as string || "";
    const endDate = req.query.endDate as string || "";
    const tab = req.query.tab as string || "overview";

    const take = 10;
    const skip = (Math.max(1, page) - 1) * take;

    const conditions = [];

    if (search) {
      conditions.push(ilike(leads.phone, `%${search}%`));
    }

    if (status !== "ALL" && tab === 'overview') {
      conditions.push(eq(assessments.status, status as any));
    }

    if (priority !== "ALL" && tab === 'overview') {
      if (priority === "HIGH") {
        conditions.push(gte(assessments.score, 80));
      } else if (priority === "MID") {
        conditions.push(and(gte(assessments.score, 50), lte(assessments.score, 79)));
      } else if (priority === "LOW") {
        conditions.push(lte(assessments.score, 49));
      } else if (priority === "UNSCORED") {
        conditions.push(sql`${assessments.score} IS NULL`);
      }
    }

    if (payment !== "ALL" && tab === 'overview') {
      if (payment === "PAID") {
        conditions.push(eq(leads.hasPaid, true));
      } else if (payment === "UNPAID") {
        conditions.push(eq(leads.hasPaid, false));
      }
    }

    if (tab === 'lifecycle') {
      conditions.push(eq(leads.hasPaid, true));
      conditions.push(eq(assessments.status, "COMPLETED"));
    }

    if (tab === 'payment_abandoned') {
      conditions.push(eq(assessments.status, "COMPLETED"));
      conditions.push(eq(leads.hasPaid, false));
    }

    if (tab === 'assessment_abandoned') {
      conditions.push(sql`${assessments.status} != 'COMPLETED' OR ${assessments.status} IS NULL`);
    }

    if (lifecycle !== "ALL" && tab === 'lifecycle') {
      if (lifecycle === "WEEK_1") {
        conditions.push(sql`EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) <= 7`);
      } else if (lifecycle === "WEEK_2") {
        conditions.push(sql`EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) > 7 AND EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) <= 14`);
      } else if (lifecycle === "WEEK_3") {
        conditions.push(sql`EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) > 14 AND EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) <= 21`);
      } else if (lifecycle === "WEEK_4") {
        conditions.push(sql`EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) > 21 AND EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) <= 28`);
      } else if (lifecycle === "EXPIRED") {
        conditions.push(sql`EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) > 28`);
      }
    }

    if (startDate) {
      conditions.push(gte(leads.updatedAt, new Date(`${startDate}T00:00:00.000Z`)));
    }
    if (endDate) {
      conditions.push(lte(leads.updatedAt, new Date(`${endDate}T23:59:59.999Z`)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await db.select({ count: sql<number>`cast(count(${leads.id}) as int)` })
      .from(leads)
      .leftJoin(assessments, eq(leads.id, assessments.leadId))
      .where(whereClause);
    
    const totalCount = countResult[0].count;

    const fetchedData = await db.select()
      .from(leads)
      .leftJoin(assessments, eq(leads.id, assessments.leadId))
      .where(whereClause)
      .orderBy(desc(leads.updatedAt))
      .limit(take)
      .offset(skip);

    const leadsFormatted = fetchedData.map(row => ({
      ...row.Lead,
      assessment: row.Assessment
    }));

    const totalPages = Math.max(1, Math.ceil(totalCount / take));

    const totalLeadsResult = await db.select({ count: sql<number>`cast(count(${leads.id}) as int)` }).from(leads);
    const totalAssessmentsResult = await db.select({ count: sql<number>`cast(count(${assessments.id}) as int)` })
      .from(assessments).where(eq(assessments.status, "COMPLETED"));
    const totalRevenueResult = await db.select({ sum: sql<number>`cast(sum(${razorpayPayments.amount}) as int)` })
      .from(razorpayPayments).where(eq(razorpayPayments.status, "captured"));
    
    const metrics = {
      totalLeads: totalLeadsResult[0]?.count || 0,
      completedAssessments: totalAssessmentsResult[0]?.count || 0,
      totalRevenue: totalRevenueResult[0]?.sum || 0
    };

    const rawLeadsByDate = await db.execute(sql`
      SELECT date_trunc('day', "createdAt")::date as date, cast(count(id) as int) as count 
      FROM "Lead" 
      GROUP BY date_trunc('day', "createdAt") 
      ORDER BY date ASC
    `);

    const leadsByDate = rawLeadsByDate.rows.map(row => ({
      date: new Date(row.date as string).toISOString().split('T')[0],
      count: row.count as number
    }));

    const rawStatuses = await db.execute(sql`
      SELECT status, cast(count(id) as int) as value 
      FROM "Assessment" 
      GROUP BY status
    `);

    const assessmentStatuses = rawStatuses.rows.map(row => ({
      name: String(row.status).replace("_", " "),
      value: row.value as number
    })).filter(s => s.value > 0);

    const rawPayments = await db.execute(sql`
      SELECT "hasPaid", cast(count(id) as int) as value 
      FROM "Lead" 
      GROUP BY "hasPaid"
    `);

    const paymentStatuses = rawPayments.rows.map(row => ({
      name: row.hasPaid ? "PAID" : "UNPAID",
      value: row.value as number
    }));

    return res.json({
      leadsFormatted,
      totalCount,
      totalPages,
      metrics,
      leadsByDate,
      assessmentStatuses,
      paymentStatuses
    });

  } catch (error) {
    console.error("Dashboard Fetch Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getLeadById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const lead = await db.query.leads.findFirst({
      where: eq(leads.id, id),
      with: {
        activityLogs: {
          orderBy: (logs, { asc }) => [asc(logs.createdAt)]
        },
        assessment: {
          with: {
            messages: {
              orderBy: (msgs, { asc }) => [asc(msgs.createdAt)]
            }
          }
        }
      }
    });

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    return res.json(lead);
  } catch (error) {
    console.error("Fetch Lead Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
