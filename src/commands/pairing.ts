import { pairingManager } from '../core/pairing.js';

export async function runPairing() {
  const args = process.argv.slice(3);
  const action = args[0];

  switch (action) {
    case 'approve':
      if (args.length < 2) {
        console.error('Usage: copy-clawd pairing approve <code>');
        process.exit(1);
      }
      const result = pairingManager.approveByCode(args[1]);
      console.log(result.message);
      break;

    case 'reject':
    case 'revoke':
      if (args.length < 3) {
        console.error('Usage: copy-clawd pairing reject <platform> <userId>');
        process.exit(1);
      }
      pairingManager.removeUser(args[1], args[2]);
      console.log(`User ${args[2]} on ${args[1]} has been rejected`);
      break;

    case 'list':
      const users = pairingManager.getPairedUsers();
      if (users.length === 0) {
        console.log('No paired users');
      } else {
        console.log('Paired users:');
        users.forEach(u => {
          console.log(`  ${u.platform}:${u.userId} - ${u.approved ? 'approved' : 'pending'}`);
        });
      }
      break;

    default:
      console.log(`
Pairing Management Commands:
  copy-clawd pairing approve <code>    Approve a pairing request
  copy-clawd pairing reject <platform> <userId>  Reject a user
  copy-clawd pairing list              List all paired users

Examples:
  copy-clawd pairing approve JFY4PLJ6
  copy-clawd pairing reject telegram 7827553050
  copy-clawd pairing list
`);
  }
}
