import { connectDB } from "@/lib/mongodb";

export async function GET() {
  await connectDB();
  return new Response("DB Connected");
}