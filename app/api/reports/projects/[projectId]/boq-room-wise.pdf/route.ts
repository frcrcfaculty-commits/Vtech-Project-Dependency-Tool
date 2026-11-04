import { handle, HttpError, requireUser } from '@/lib/auth';
import { loadPdfFonts } from '@/lib/pdf/fonts';
import { buildBoqRoomWisePdf, type BoqLineItem } from '@/lib/pdf/boqReport';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  return handle(async () => {
    const { projectId } = await ctx.params;
    if (!UUID.test(projectId)) throw new HttpError(400, 'Bad project id');
    const { db } = await requireUser();

    const { data: project, error: pErr } = await db
      .from('projects')
      .select('name, client_name, site_address')
      .eq('id', projectId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!project) throw new HttpError(404, 'Project not found');

    const { data: lines, error: lErr } = await db
      .from('room_products')
      .select('id, location, quantity, brand, make, model, note, boq_title, product_catalogue(title), rooms(name, sort, floors(label, sort))')
      .eq('project_id', projectId);
    if (lErr) throw lErr;

    type Raw = {
      location: string | null;
      quantity: number;
      brand: string | null;
      make: string | null;
      model: string | null;
      note: string | null;
      boq_title: string | null;
      product_catalogue: { title: string } | null;
      rooms: { name: string; sort: number; floors: { label: string; sort: number } | null } | null;
    };

    const boqLines: BoqLineItem[] = ((lines as unknown as Raw[]) ?? []).map((l) => ({
      floorLabel: l.rooms?.floors?.label ?? '',
      floorSort: l.rooms?.floors?.sort ?? 999,
      roomName: l.rooms?.name ?? 'Project-wide',
      roomSort: l.rooms?.sort ?? 0,
      productTitle: l.product_catalogue?.title ?? l.boq_title ?? 'Product',
      location: l.location,
      make: l.make || l.brand || null,
      model: l.model,
      quantity: l.quantity || 1,
      note: l.note,
    }));

    const generatedOn = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const pdf = await buildBoqRoomWisePdf(
      {
        projectName: project.name,
        clientName: project.client_name,
        siteAddress: project.site_address,
        generatedOn,
        lines: boqLines,
      },
      await loadPdfFonts()
    );

    const safeName = project.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'project';
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}_BOQ_RoomWise_${generatedOn}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
