import app from './src/app';
console.log(app._router.stack.filter((r: any) => r.name === 'router').map((r: any) => r.regexp));
process.exit(0);
