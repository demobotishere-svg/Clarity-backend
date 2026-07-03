import { Request, Response } from "express";
import { db } from "../lib/db";
import { admins, leads, assessments, activityLogs, razorpayPayments, messages as messagesTable } from "../db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { SignJWT } from "jose";

const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET || "fallback_secret_key_change_me";
  return new TextEncoder().encode(secret);
};

export const setupAdmin = async (req: Request, res: Response) => {
  try {
    const admin = (req as any).admin;
    if (!admin) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const phone = req.body.phone;

    if (!phone || typeof phone !== "string" || phone.length < 10) {
      return res.status(400).json({ error: "Invalid phone number" });
    }

    await db.update(admins).set({ phone }).where(eq(admins.id, admin.id));

    const newToken = await new SignJWT({ 
      id: admin.id, 
      email: admin.email,
      hasPhone: true 
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(getJwtSecretKey());

    res.cookie("admin_token", newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 1000,
      path: "/",
    });

    return res.json({ success: true });

  } catch (error) {
    console.error("Setup API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getTableData = async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    const page = parseInt(req.query.page as string || "1", 10);
    const take = 100;
    const skip = (Math.max(1, page) - 1) * take;

    let data: any[] = [];
    let totalCount = 0;

    switch (tableName.toLowerCase()) {
      case "leads":
        totalCount = (await db.select({ count: sql<number>`cast(count(${leads.id}) as int)` }).from(leads))[0].count;
        data = await db.query.leads.findMany({ limit: take, offset: skip, orderBy: (table, { desc }) => [desc(table.createdAt)] });
        break;
      case "admins":
        totalCount = (await db.select({ count: sql<number>`cast(count(${admins.id}) as int)` }).from(admins))[0].count;
        data = await db.query.admins.findMany({ limit: take, offset: skip, orderBy: (table, { desc }) => [desc(table.createdAt)] });
        
        // Sanitize passwordHash from output
        data = data.map(admin => {
          const { passwordHash, ...safeAdmin } = admin;
          return safeAdmin;
        });
        break;
      case "assessments":
        totalCount = (await db.select({ count: sql<number>`cast(count(${assessments.id}) as int)` }).from(assessments))[0].count;
        data = await db.query.assessments.findMany({ limit: take, offset: skip, orderBy: (table, { desc }) => [desc(table.createdAt)] });
        break;
      case "messages":
        totalCount = (await db.select({ count: sql<number>`cast(count(${messagesTable.id}) as int)` }).from(messagesTable))[0].count;
        data = await db.query.messages.findMany({ limit: take, offset: skip, orderBy: (table, { desc }) => [desc(table.createdAt)] });
        break;
      case "activitylogs":
        totalCount = (await db.select({ count: sql<number>`cast(count(${activityLogs.id}) as int)` }).from(activityLogs))[0].count;
        data = await db.query.activityLogs.findMany({ limit: take, offset: skip, orderBy: (table, { desc }) => [desc(table.createdAt)] });
        break;
      case "razorpaypayments":
        totalCount = (await db.select({ count: sql<number>`cast(count(${razorpayPayments.id}) as int)` }).from(razorpayPayments))[0].count;
        data = await db.query.razorpayPayments.findMany({ limit: take, offset: skip, orderBy: (table, { desc }) => [desc(table.createdAt)] });
        break;
      default:
        return res.status(404).json({ error: "Table not found" });
    }

    const totalPages = Math.max(1, Math.ceil(totalCount / take));

    return res.json({ data, totalCount, totalPages });

  } catch (error) {
    console.error("Table Fetch Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
