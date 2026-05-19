import { SubscriptionService } from '../src/subscription.service';
import { SubscriptionRepository, PaymentGateway, EmailService, Subscription } from '../src/interfaces';

describe('SubscriptionService Unit Tests', () => {
  let service: SubscriptionService;
  let mockRepo: jest.Mocked<SubscriptionRepository>;
  let mockPayment: jest.Mocked<PaymentGateway>;
  let mockEmail: jest.Mocked<EmailService>;

  beforeEach(() => {
    mockRepo = { findByUserId: jest.fn(), save: jest.fn() };
    mockPayment = { charge: jest.fn() };
    mockEmail = { sendConfirmation: jest.fn() };
    service = new SubscriptionService(mockRepo, mockPayment, mockEmail);
    jest.useFakeTimers().setSystemTime(new Date('2026-05-19'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('subscribe', () => {
    it('should successfully subscribe to a free plan without payment charges', async () => {
      // Arrange
      mockRepo.findByUserId.mockResolvedValue(null);

      // Act
      const result = await service.subscribe('user1', 'free');

      // Assert
      expect(result.plan).toBe('free');
      expect(result.status).toBe('active');
      expect(mockPayment.charge).not.toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalledWith(result);
      expect(mockEmail.sendConfirmation).toHaveBeenCalledWith('user1', 'welcome');
    });

    it('should charge payment and activate subscription for basic plan', async () => {
      // Arrange
      mockRepo.findByUserId.mockResolvedValue(null);
      mockPayment.charge.mockResolvedValue(true);

      // Act
      const result = await service.subscribe('user2', 'basic');

      // Assert
      expect(result.plan).toBe('basic');
      expect(mockPayment.charge).toHaveBeenCalledWith('user2', 10);
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('should charge payment and activate subscription for premium plan', async () => {
      // Arrange
      mockRepo.findByUserId.mockResolvedValue(null);
      mockPayment.charge.mockResolvedValue(true);

      // Act
      const result = await service.subscribe('user3', 'premium');

      // Assert
      expect(result.plan).toBe('premium');
      expect(mockPayment.charge).toHaveBeenCalledWith('user3', 30);
    });

    it('should throw an error if subscription already exists and is active', async () => {
      // Arrange
      const existing: Subscription = { userId: 'user1', plan: 'free', status: 'active', expiresAt: new Date() };
      mockRepo.findByUserId.mockResolvedValue(existing);

      // Act & Assert
      await expect(service.subscribe('user1', 'premium')).rejects.toThrow('Subscription already exists');
    });

    it('should allow subscription if previous subscription was cancelled', async () => {
      // Arrange
      const existing: Subscription = { userId: 'user1', plan: 'free', status: 'cancelled', expiresAt: new Date() };
      mockRepo.findByUserId.mockResolvedValue(existing);
      mockPayment.charge.mockResolvedValue(true);

      // Act
      const result = await service.subscribe('user1', 'basic');

      // Assert
      expect(result.status).toBe('active');
    });

    it('should throw an error if transaction payment drops and fails', async () => {
      // Arrange
      mockRepo.findByUserId.mockResolvedValue(null);
      mockPayment.charge.mockResolvedValue(false);

      // Act & Assert
      await expect(service.subscribe('user1', 'basic')).rejects.toThrow('Payment failed');
      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('upgrade', () => {
    it('should successfully upgrade from basic to premium and charge delta amount', async () => {
      // Arrange
      const current: Subscription = { userId: 'user1', plan: 'basic', status: 'active', expiresAt: new Date() };
      mockRepo.findByUserId.mockResolvedValue(current);
      mockPayment.charge.mockResolvedValue(true);

      // Act
      const result = await service.upgrade('user1', 'premium');

      // Assert
      expect(result.plan).toBe('premium');
      expect(mockPayment.charge).toHaveBeenCalledWith('user1', 20);
      expect(mockRepo.save).toHaveBeenCalled();
      expect(mockEmail.sendConfirmation).toHaveBeenCalledWith('user1', 'upgrade');
    });

    it('should throw error if upgrade target is lower tier (downgrade test)', async () => {
      // Arrange
      const current: Subscription = { userId: 'user1', plan: 'premium', status: 'active', expiresAt: new Date() };
      mockRepo.findByUserId.mockResolvedValue(current);

      // Act & Assert
      await expect(service.upgrade('user1', 'basic')).rejects.toThrow('Downgrade or same plan match not allowed in upgrade');
    });

    it('should throw error if upgrade target matches current plan tier', async () => {
      // Arrange
      const current: Subscription = { userId: 'user1', plan: 'basic', status: 'active', expiresAt: new Date() };
      mockRepo.findByUserId.mockResolvedValue(current);

      // Act & Assert
      await expect(service.upgrade('user1', 'basic')).rejects.toThrow('Downgrade or same plan match not allowed in upgrade');
    });

    it('should throw error on upgrade attempt if active contract does not exist', async () => {
      // Arrange
      mockRepo.findByUserId.mockResolvedValue(null);

      // Act & Assert
      await expect(service.upgrade('user1', 'premium')).rejects.toThrow('No active subscription found');
    });

    it('should throw error on upgrade attempt if target is active but status is cancelled', async () => {
      // Arrange
      const current: Subscription = { userId: 'user1', plan: 'basic', status: 'cancelled', expiresAt: new Date() };
      mockRepo.findByUserId.mockResolvedValue(current);

      // Act & Assert
      await expect(service.upgrade('user1', 'premium')).rejects.toThrow('No active subscription found');
    });

    it('should rollback and throw error if upgrade payment collection fails', async () => {
      // Arrange
      const current: Subscription = { userId: 'user1', plan: 'basic', status: 'active', expiresAt: new Date() };
      mockRepo.findByUserId.mockResolvedValue(current);
      mockPayment.charge.mockResolvedValue(false);

      // Act & Assert
      await expect(service.upgrade('user1', 'premium')).rejects.toThrow('Payment failed');
    });
  });

  describe('cancel', () => {
    it('should transition target subscription state status to cancelled', async () => {
      // Arrange
      const current: Subscription = { userId: 'user1', plan: 'premium', status: 'active', expiresAt: new Date() };
      mockRepo.findByUserId.mockResolvedValue(current);

      // Act
      const result = await service.cancel('user1');

      // Assert
      expect(result.status).toBe('cancelled');
      expect(mockRepo.save).toHaveBeenCalled();
      expect(mockEmail.sendConfirmation).toHaveBeenCalledWith('user1', 'cancellation');
    });

    it('should throw error if cancel target record is missing from repository', async () => {
      // Arrange
      mockRepo.findByUserId.mockResolvedValue(null);

      // Act & Assert
      await expect(service.cancel('user1')).rejects.toThrow('Subscription not found');
    });

    it('should throw error if target subscription status is already marked cancelled', async () => {
      // Arrange
      const current: Subscription = { userId: 'user1', plan: 'premium', status: 'cancelled', expiresAt: new Date() };
      mockRepo.findByUserId.mockResolvedValue(current);

      // Act & Assert
      await expect(service.cancel('user1')).rejects.toThrow('Subscription is already cancelled');
    });
  });

  describe('isFeatureAllowed', () => {
    it('should give access to read feature under default anonymous/free plan', async () => {
      // Arrange
      mockRepo.findByUserId.mockResolvedValue(null);

      // Act
      const allowed = await service.isFeatureAllowed('user1', 'read');

      // Assert
      expect(allowed).toBe(true);
    });

    it('should deny export feature access under standard free tier plan tier', async () => {
      // Arrange
      mockRepo.findByUserId.mockResolvedValue(null);

      // Act
      const allowed = await service.isFeatureAllowed('user1', 'export');

      // Assert
      expect(allowed).toBe(false);
    });

    it('should give write feature access permissions to basic tier user', async () => {
      // Arrange
      const current: Subscription = { userId: 'user1', plan: 'basic', status: 'active', expiresAt: new Date() };
      mockRepo.findByUserId.mockResolvedValue(current);

      // Act
      const allowed = await service.isFeatureAllowed('user1', 'write');

      // Assert
      expect(allowed).toBe(true);
    });

    it('should give premium analytical feature permission scope access to premium tiers', async () => {
      // Arrange
      const current: Subscription = { userId: 'user1', plan: 'premium', status: 'active', expiresAt: new Date() };
      mockRepo.findByUserId.mockResolvedValue(current);

      // Act
      const allowed = await service.isFeatureAllowed('user1', 'analytics');

      // Assert
      expect(allowed).toBe(true);
    });

    it('should default down to free feature scope capabilities if target profile was cancelled', async () => {
      // Arrange
      const current: Subscription = { userId: 'user1', plan: 'premium', status: 'cancelled', expiresAt: new Date() };
      mockRepo.findByUserId.mockResolvedValue(current);

      // Act
      const allowed = await service.isFeatureAllowed('user1', 'analytics');

      // Assert
      expect(allowed).toBe(false);
    });
  });

  describe('getRemainingDays', () => {
    it('should evaluate exactly 30 remaining days for fresh active subscription contracts', async () => {
      // Arrange
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const current: Subscription = { userId: 'user1', plan: 'premium', status: 'active', expiresAt: expires };
      mockRepo.findByUserId.mockResolvedValue(current);

      // Act
      const days = await service.getRemainingDays('user1');

      // Assert
      expect(days).toBe(30);
    });

    it('should return 0 days if user profile record is empty or completely missing', async () => {
      // Arrange
      mockRepo.findByUserId.mockResolvedValue(null);

      // Act
      const days = await service.getRemainingDays('user1');

      // Assert
      expect(days).toBe(0);
    });

    it('should output 0 days remaining if target contract is expired down past time window bounds', async () => {
      // Arrange
      const expires = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const current: Subscription = { userId: 'user1', plan: 'premium', status: 'active', expiresAt: expires };
      mockRepo.findByUserId.mockResolvedValue(current);

      // Act
      const days = await service.getRemainingDays('user1');

      // Assert
      expect(days).toBe(0);
    });
  });
});
