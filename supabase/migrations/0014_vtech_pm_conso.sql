-- v9 (VTech, 2026-11-05). No temp tables (Supabase SQL editor).
-- 1. "VTECH Sales Team" is shown as "VTECH PM" everywhere (Hansal). The reminder category "Sales dependency" keeps its name.
-- 2. Conso groups for the BOQ "Conso" view (sheet "Ashutosh Project Status", tab "Conso").

update public.agency_types set name = 'VTECH PM' where name = 'VTECH Sales Team';
update public.step_reasons set agency_type = 'VTECH PM' where agency_type = 'VTECH Sales Team';

alter table public.product_catalogue add column conso_group text, add column conso_sort int;
update public.product_catalogue p set conso_group = v.grp, conso_sort = v.sort
  from (values
    ('Keypad', 'User interface', 1), ('Wall panel', 'User interface', 2), ('QSM', 'User interface', 3),
    ('Sensor Intelligent', 'User interface', 4), ('Sensor sada', 'User interface', 5),
    ('Automation DB', 'Backend', 10), ('Off Termination', 'Backend', 11), ('Fan control', 'Backend', 12),
    ('Dimmer dali', 'Backend', 13), ('Dimmer', 'Backend', 14), ('Lutron processor', 'Backend', 15), ('AC control', 'Backend', 16),
    ('AV Rack', 'AV Rack location', 20), ('AV Control', 'AV Rack location', 21), ('Crestron Processor', 'AV Rack location', 22),
    ('Curtain', 'Curtain', 30),
    ('Speakers', 'Audio', 40), ('Amplification', 'Audio', 41), ('Home Theatre', 'Audio', 42), ('Other AV devices', 'Audio', 43),
    ('Door lock', 'Door lock', 50), ('Ekey scanner', 'Door lock', 51),
    ('Camera', 'Camera', 61),
    ('Switch /Router', 'Network', 80), ('Wifi Access point', 'Network', 81),
    ('iPhone programming', 'Misc', 90), ('Client Side', 'Misc', 91)
  ) v(title, grp, sort)
 where p.title = v.title;
-- Groups in the sheet without a catalogue product yet (NVR, EPABX backend, EPABX room socket, Power sockets) appear once VTech adds them.
