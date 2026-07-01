import mongoose from 'mongoose'

const membershipPlanSchema = new mongoose.Schema(
  {
    name: String,
    durationMonths: Number,
    durationDays: Number,
    gymId: String,
    active: Boolean,
    price: Number,
  },
  { timestamps: true }
)

const MembershipPlan = mongoose.models.MembershipPlan || mongoose.model('MembershipPlan', membershipPlanSchema)

async function main() {
  await mongoose.connect('mongodb://localhost:27017/fitflix')
  
  // Update the "day plan" to have durationDays: 1 (it was supposed to be a 1-day plan)
  const updated = await MembershipPlan.findOneAndUpdate(
    { name: 'day plan' },
    { $set: { durationDays: 1 } },
    { new: true }
  )
  console.log('Updated:', JSON.stringify(updated?.toObject()))
  
  // Verify all plans
  const plans = await MembershipPlan.find({}, { name: 1, durationMonths: 1, durationDays: 1, gymId: 1, active: 1 })
  console.log('\nAll plans:')
  plans.forEach((p) => console.log(JSON.stringify(p.toObject())))
  
  await mongoose.disconnect()
}

main().catch(console.error)
