import gymVisitRouter from './src/routes/gymVisit.routes';
console.log("gymVisitRouter stack length:", gymVisitRouter.stack?.length);
console.log("routes:", gymVisitRouter.stack?.map((layer: any) => layer.route?.path));
process.exit(0);
