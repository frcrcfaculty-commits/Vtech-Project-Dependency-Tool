/** Today's date in India (VTech works in IST), as YYYY-MM-DD. Do not use new Date().toISOString(): that is the UTC date,
 *  which is still "yesterday" between 00:00 and 05:30 IST. */
export const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
