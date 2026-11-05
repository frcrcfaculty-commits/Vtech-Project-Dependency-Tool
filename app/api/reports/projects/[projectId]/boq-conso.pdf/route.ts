import { handle, HttpError, requireUser } from '@/lib/auth';
import { loadPdfFonts } from '@/lib/pdf/fonts';
import { buildBoqConsoPdf, type ConsoItem } from '@/lib/pdf/boqReport';

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
      .select('id, location, quantity, brand, make, model, boq_title, product_catalogue(title, conso_group, conso_sort), rooms(name)')
      .eq('project_id', projectId);
    if (lErr) throw lErr;

    type Raw = {
      location: string | null;
      quantity: number;
      brand: string | null;
      make: string | null;
      model: string | null;
      boq_title: string | null;
      product_catalogue: { title: string; conso_group: string | null; conso_sort: number | null } | null;
      rooms: { name: string } | null;
    };

    // Consolidate per productTitle + make + model
    const map = new Map<
      string,
      {
        productTitle: string;
        make: string | null;
        model: string | null;
        totalQuantity: number;
        consoGroup: string;
        consoSort: number;
        rooms: Set<string>;
        locs: Set<string>;
      }
    >();

    for (const l of (lines as unknown as Raw[]) ?? []) {
      const title = l.product_catalogue?.title ?? l.boq_title ?? 'Product';
      const make = l.make || l.brand || null;
      const model = l.model || null;
      const consoGroup = l.product_catalogue?.conso_group || 'Other';
      const consoSort = l.product_catalogue?.conso_sort ?? (consoGroup === 'Other' ? 999 : 90);
      const key = `${title}__${make ?? ''}__${model ?? ''}`.toLowerCase();

      const existing = map.get(key) ?? {
        productTitle: title,
        make,
        model,
        totalQuantity: 0,
        consoGroup,
        consoSort,
        rooms: new Set<string>(),
        locs: new Set<string>(),
      };

      existing.totalQuantity += l.quantity || 1;
      if (l.rooms?.name) existing.rooms.add(l.rooms.name);
      const roomDesc = [l.rooms?.name, l.location].filter(Boolean).join(' - ');
      if (roomDesc) existing.locs.add(roomDesc);
      map.set(key, existing);
    }

    const consoItems: ConsoItem[] = [...map.values()]
      .sort((a, b) => a.consoSort - b.consoSort || b.totalQuantity - a.totalQuantity || a.productTitle.localeCompare(b.productTitle))
      .map((it) => ({
        productTitle: it.productTitle,
        make: it.make,
        model: it.model,
        totalQuantity: it.totalQuantity,
        consoGroup: it.consoGroup,
        consoSort: it.consoSort,
        roomsCount: it.rooms.size,
        locations: [...it.locs].join(', ') || '—',
      }));

    const generatedOn = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const pdf = await buildBoqConsoPdf(
      {
        projectName: project.name,
        clientName: project.client_name,
        siteAddress: project.site_address,
        generatedOn,
        items: consoItems,
      },
      await loadPdfFonts()
    );

    const safeName = project.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'project';
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}_BOQ_Conso_${generatedOn}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
