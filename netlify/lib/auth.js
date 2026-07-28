export function checkStaff(req, config) {
  const token = req.headers.get('x-staff-token') || '';
  return Boolean(config.staffPassword) && token === config.staffPassword;
}
