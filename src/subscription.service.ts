import { 
  SubscriptionRepository, PaymentGateway, EmailService, 
  Subscription, SubscriptionPlan 
} from './interfaces';

export class SubscriptionService {
  private planPrices: Record<SubscriptionPlan, number> = {
    free: 0,
    basic: 10,
    premium: 30
  };

  private planFeatures: Record<SubscriptionPlan, string[]> = {
    free: ['read'],
    basic: ['read', 'write'],
    premium: ['read', 'write', 'export', 'analytics']
  };

  constructor(
    private repo: SubscriptionRepository,
    private payment: PaymentGateway,
    private email: EmailService
  ) {}

  async subscribe(userId: string, plan: SubscriptionPlan): Promise<Subscription> {
    const existing = await this.repo.findByUserId(userId);
    if (existing && existing.status === 'active') {
      throw new Error('Subscription already exists');
    }

    const price = this.planPrices[plan];
    if (price > 0) {
      const success = await this.payment.charge(userId, price);
      if (!success) throw new Error('Payment failed');
    }

    const subscription: Subscription = {
      userId,
      plan,
      status: 'active',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    };

    await this.repo.save(subscription);
    await this.email.sendConfirmation(userId, 'welcome');
    return subscription;
  }

  async upgrade(userId: string, newPlan: SubscriptionPlan): Promise<Subscription> {
    const current = await this.repo.findByUserId(userId);
    if (!current || current.status !== 'active') {
      throw new Error('No active subscription found');
    }

    const currentTier = this.planPrices[current.plan];
    const newTier = this.planPrices[newPlan];

    if (newTier <= currentTier) {
      throw new Error('Downgrade or same plan match not allowed in upgrade');
    }

    const priceDiff = newTier - currentTier;
    const success = await this.payment.charge(userId, priceDiff);
    if (!success) throw new Error('Payment failed');

    current.plan = newPlan;
    current.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.repo.save(current);
    await this.email.sendConfirmation(userId, 'upgrade');
    return current;
  }

  async cancel(userId: string): Promise<Subscription> {
    const current = await this.repo.findByUserId(userId);
    if (!current) {
      throw new Error('Subscription not found');
    }
    if (current.status === 'cancelled') {
      throw new Error('Subscription is already cancelled');
    }

    current.status = 'cancelled';
    await this.repo.save(current);
    await this.email.sendConfirmation(userId, 'cancellation');
    return current;
  }

  async isFeatureAllowed(userId: string, feature: string): Promise<boolean> {
    const current = await this.repo.findByUserId(userId);
    if (!current || current.status !== 'active') {
      return this.planFeatures['free'].includes(feature);
    }
    return this.planFeatures[current.plan].includes(feature);
  }

  async getRemainingDays(userId: string): Promise<number> {
    const current = await this.repo.findByUserId(userId);
    if (!current || current.status !== 'active') return 0;

    const diffTime = current.expiresAt.getTime() - Date.now();
    if (diffTime <= 0) return 0;

    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}
