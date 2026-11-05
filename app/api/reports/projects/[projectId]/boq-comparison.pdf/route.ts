import { handle, HttpError, requireUser } from '@/lib/auth';
import { loadPdfFonts } from '@/lib/pdf/fonts';
import {
  buildBoqComparisonPdf,
  type BoqComparisonItem,
  type BoqComparisonChangeEvent,
} from '@/lib/pdf/boqComparisonReport';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  return handle(async () => {
    const { projectId } = await ctx.params;
    if (!UUID.test(projectId)) throw new HttpError(400, 'Bad project id');
    const { db } = await requireUser();

    // 1. Project details
    const { data: project, error: pErr } = await db
      .from('projects')
      .select('name, client_name, site_address')
      .eq('id', projectId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!project) throw new HttpError(404, 'Project not found');

    // 2. Initial BOQ from boq_events (added and change_id is null)
    const { data: initialEvents, error: iErr } = await db
      .from('boq_events')
      .select('product, quantity')
      .eq('project_id', projectId)
      .eq('event', 'added')
      .is('change_id', null);
    if (iErr) throw iErr;

    // 3. Current BOQ from room_products (with conso info from catalogue)
    const { data: currentLines, error: cErr } = await db
      .from('room_products')
      .select('quantity, boq_title, product_catalogue(title, conso_group, conso_sort)')
      .eq('project_id', projectId);
    if (cErr) throw cErr;

    // 4. Change events from boq_events (change_id is not null)
    const { data: changeRows, error: chgErr } = await db
      .from('boq_events')
      .select('at, event, product, floor, room, location, quantity, project_changes(requested_by, reason, reference_type, reference)')
      .eq('project_id', projectId)
      .not('change_id', 'is', null)
      .order('at', { ascending: false });
    if (chgErr) throw chgErr;

    // Product metadata & quantity tracker
    type ProductAgg = {
      productTitle: string;
      consoGroup: string;
      consoSort: number;
      initialQuantity: number;
      currentQuantity: number;
    };

    const aggMap = new Map<string, ProductAgg>();

    // Index initial quantities
    for (const row of (initialEvents as { product: string; quantity: number | null }[]) ?? []) {
      const title = row.product || 'Product';
      const key = title.trim().toLowerCase();
      const existing = aggMap.get(key) ?? {
        productTitle: title,
        consoGroup: 'Other',
        consoSort: 999,
        initialQuantity: 0,
        currentQuantity: 0,
      };
      existing.initialQuantity += row.quantity || 1;
      aggMap.set(key, existing);
    }

    // Index current quantities & resolve conso metadata
    type CurrentRow = {
      quantity: number;
      boq_title: string | null;
      product_catalogue: { title: string; conso_group: string | null; conso_sort: number | null } | null;
    };

    for (const row of (currentLines as unknown as CurrentRow[]) ?? []) {
      const title = row.product_catalogue?.title ?? row.boq_title ?? 'Product';
      const key = title.trim().toLowerCase();
      const consoGroup = row.product_catalogue?.conso_group || 'Other';
      const consoSort = row.product_catalogue?.conso_sort ?? (consoGroup === 'Other' ? 999 : 90);

      const existing = aggMap.get(key) ?? {
        productTitle: title,
        consoGroup,
        consoSort,
        initialQuantity: 0,
        currentQuantity: 0,
      };

      existing.currentQuantity += row.quantity || 1;
      existing.consoGroup = consoGroup;
      existing.consoSort = consoSort;
      aggMap.set(key, existing);
    }

    // If an initial item didn't match a current catalogue join, attempt lookup in product_catalogue
    const missingGroupKeys = [...aggMap.values()].filter((it) => it.consoGroup === 'Other');
    if (missingGroupKeys.length > 0) {
      const titles = missingGroupKeys.map((k) => k.productTitle);
      const { data: catalogueRows } = await db
        .from('product_catalogue')
        .select('title, conso_group, conso_sort')
        .in('title', titles);

      for (const cat of catalogueRows ?? []) {
        const key = cat.title.trim().toLowerCase();
        const existing = aggMap.get(key);
        if (existing && cat.conso_group) {
          existing.consoGroup = cat.conso_group;
          existing.consoSort = cat.conso_sort ?? 90;
        }
      }
    }

    const comparisonItems: BoqComparisonItem[] = [...aggMap.values()].map((agg) => ({
      consoGroup: agg.consoGroup,
      consoSort: agg.consoSort,
      productTitle: agg.productTitle,
      initialQuantity: agg.initialQuantity,
      currentQuantity: agg.currentQuantity,
      diff: agg.currentQuantity - agg.initialQuantity,
    }));

    type ChangeEventRaw = {
      at: string;
      event: 'added' | 'removed' | 'changed';
      product: string;
      floor: string | null;
      room: string | null;
      location: string | null;
      quantity: number | null;
      project_changes: {
        requested_by: string;
        reason: string;
        reference_type: string | null;
        reference: string | null;
      } | null;
    };

    const changeEvents: BoqComparisonChangeEvent[] = ((changeRows as unknown as ChangeEventRaw[]) ?? []).map((chg) => ({
      at: chg.at,
      event: chg.event,
      product: chg.product,
      floor: chg.floor,
      room: chg.room,
      location: chg.location,
      quantity: chg.quantity,
      requestedBy: chg.project_changes?.requested_by ?? '—',
      reason: chg.project_changes?.reason ?? '—',
      referenceType: chg.project_changes?.reference_type ?? null,
      reference: chg.project_changes?.reference ?? null,
    }));

    const generatedOn = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const pdf = await buildBoqComparisonPdf(
      {
        projectName: project.name,
        clientName: project.client_name,
        siteAddress: project.site_address,
        generatedOn,
        comparisonItems,
        changeEvents,
      },
      await loadPdfFonts()
    );

    const safeName = project.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'project';
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}_BOQ_Comparison_${generatedOn}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}

