export type SubscriptionPlan = 'free' | 'basic' | 'premium';

export interface Subscription {
  userId: string;
  plan: SubscriptionPlan;
  status: 'active' | 'cancelled';
  expiresAt: Date;
}

export interface SubscriptionRepository {
  findByUserId(userId: string): Promise<Subscription | null>;
  save(subscription: Subscription): Promise<void>;
}

export interface PaymentGateway {
  charge(userId: string, amount: number): Promise<boolean>;
}

export interface EmailService {
  sendConfirmation(userId: string, type: string): Promise<void>;
}
