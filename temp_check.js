const fs = require('fs');
const c = fs.readFileSync('messages/ar.json','utf8');
// Find Admin section
const adminIdx = c.lastIndexOf('"Admin"');
if (adminIdx >= 0) {
  console.log('Admin section found at', adminIdx);
  // Find the closing of Admin
  const afterAdmin = c.slice(adminIdx, adminIdx + 5000);
  console.log('Admin section (first 500 chars):');
  console.log(afterAdmin.slice(0, 500));
  console.log('---END---');
}
// Find Auth section
const authIdx = c.lastIndexOf('"Auth"');
console.log('Auth starts at', authIdx);
console.log('Between Admin close and Auth:');
console.log(c.slice(Math.max(0, authIdx - 100), authIdx + 20));
