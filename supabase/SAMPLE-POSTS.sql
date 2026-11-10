-- Sample posts so the app looks alive: prayers, socials and short announcements.
-- Run once in the Supabase SQL editor. Dates are relative to "now", so the
-- Updates page and the Calendar fill up straight away.
--
-- Push notifications are switched off during the insert so students are not
-- pinged about sample posts. Remove them later from the admin page, or with
-- a delete on public.updates for the titles below.

begin;
alter table public.updates disable trigger updates_notify_on_change;

insert into public.updates (type, status, title, body, location, event_time, accepts_feedback, pinned, priority) values
-- announcements (no date needed)
('announcement', 'active', 'Welcome back, everyone',
 'We meet every Friday this term. New faces are always welcome, whether you have been to one before or not. Bring a friend!',
 null, null, false, true, 'important'),
('announcement', 'active', 'Shirts will be here by next Monday',
 'Club shirts are almost done. Pick yours up in room 2105 at lunch. Please bring your name so we can find your size.',
 '2105', null, false, false, 'normal'),
('announcement', 'active', 'Ramadan planning meeting moved',
 'We moved the planning meeting to Thursday so more people can come. Snacks included, ideas encouraged.',
 '2105', date_trunc('day', now()) + interval '2 days 12 hours 15 minutes', false, false, 'urgent'),

-- prayers
('prayer', 'active', 'Jumu''ah prayer',
 'Khutbah starts on time. Please arrive a few minutes early and bring a prayer mat if you have one.',
 '2105', date_trunc('week', now()) + interval '4 days 12 hours 10 minutes', false, false, 'normal'),
('prayer', 'active', 'Dhuhr in the quiet room',
 'A short group prayer at lunch. Open to everyone, no sign-up needed.',
 '1204', date_trunc('day', now()) + interval '1 days 12 hours 5 minutes', false, false, 'normal'),
('prayer', 'active', 'Jumu''ah prayer',
 'Khutbah topic: gratitude in everyday life. Wudu space is available near the gym.',
 '2105', date_trunc('week', now()) + interval '11 days 12 hours 10 minutes', false, false, 'normal'),

-- socials
('social', 'active', 'Pizza and games night',
 'Board games, snacks and good company. Bring a friend and your favorite game. Halal pizza provided.',
 '3102', date_trunc('day', now()) + interval '4 days 16 hours 0 minutes', true, false, 'normal'),
('social', 'active', 'Study hall + chai',
 'Quiet study time with chai and dates. A great way to catch up on homework before finals.',
 '2208', date_trunc('day', now()) + interval '6 days 15 hours 30 minutes', false, false, 'normal'),
-- one busy day: three different posts on the same date (3 days from now)
('prayer', 'active', 'Dhuhr prayer',
 'Group prayer at lunch in the prayer room. Everyone is welcome, just show up.',
 '2105', date_trunc('day', now()) + interval '3 days 12 hours 5 minutes', false, false, 'normal'),
('social', 'active', 'Lunch with the club',
 'Grab your lunch and sit with us. A relaxed way to meet new people. Snacks on the table.',
 '2208', date_trunc('day', now()) + interval '3 days 12 hours 40 minutes', false, false, 'normal'),
('announcement', 'active', 'Officer meeting after school',
 'Officers, please stay for a quick check-in about next month''s events. It should take about 20 minutes.',
 '2105', date_trunc('day', now()) + interval '3 days 15 hours 30 minutes', false, false, 'important'),

('social', 'active', 'Community service day',
 'We are packing meals for the local food bank. Wear comfortable clothes. Service hours are available.',
 'Main entrance', date_trunc('day', now()) + interval '9 days 10 hours 0 minutes', true, false, 'important');

alter table public.updates enable trigger updates_notify_on_change;
commit;
