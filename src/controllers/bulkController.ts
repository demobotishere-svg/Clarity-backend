import { Request, Response } from "express";
import { db, generateId } from "../lib/db";
import { bulkBatches, pendingMessages, leads } from "../db/schema";
import { jwtVerify } from "jose";
import { inArray, eq, desc } from "drizzle-orm";

const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET || "fallback_secret_key_change_me";
  return new TextEncoder().encode(secret);
};

export const queueBulkMessages = async (req: Request, res: Response) => {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).send("Unauthorized");

    const { payload } = await jwtVerify(token, getJwtSecretKey());
    const adminId = payload.id as string;

    const { leadIds, templateName } = req.body;

    if (!Array.isArray(leadIds) || leadIds.length === 0 || !templateName) {
      return res.status(400).send("Invalid payload");
    }

    const validLeads = await db.select({ id: leads.id }).from(leads).where(inArray(leads.id, leadIds));
    const validLeadIds = validLeads.map(l => l.id);

    if (validLeadIds.length === 0) {
      return res.status(400).send("No valid leads provided");
    }

    const batchId = generateId();

    await db.insert(bulkBatches).values({
      id: batchId,
      adminId,
      templateName,
      totalCount: validLeadIds.length,
    });

    const queueEntries = validLeadIds.map(leadId => ({
      id: generateId(),
      batchId,
      leadId,
      templateName,
    }));

    await db.insert(pendingMessages).values(queueEntries);

    return res.json({ success: true, batchId, queuedCount: validLeadIds.length });
  } catch (error) {
    console.error("Bulk Queue Error:", error);
    return res.status(500).send("Internal Server Error");
  }
};

export const getBulkReports = async (req: Request, res: Response) => {
  try {
    const batches = await db.select()
      .from(bulkBatches)
      .orderBy(desc(bulkBatches.createdAt));
    return res.json(batches);
  } catch (error) {
    console.error("Fetch Bulk Reports Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getBulkReportById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const batchResult = await db.select().from(bulkBatches).where(eq(bulkBatches.id, id));
    const batch = batchResult[0];

    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    const rawMessages = await db.select({
      id: pendingMessages.id,
      templateName: pendingMessages.templateName,
      status: pendingMessages.status,
      errorReason: pendingMessages.errorReason,
      createdAt: pendingMessages.createdAt,
      processedAt: pendingMessages.processedAt,
      leadName: leads.name,
      leadPhone: leads.phone,
    })
    .from(pendingMessages)
    .leftJoin(leads, eq(pendingMessages.leadId, leads.id))
    .where(eq(pendingMessages.batchId, id))
    .orderBy(desc(pendingMessages.createdAt));

    return res.json({ batch, messages: rawMessages });
  } catch (error) {
    console.error("Fetch Bulk Report By Id Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
