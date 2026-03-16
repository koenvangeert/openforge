import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import RateLimitToast from './RateLimitToast.svelte'
import { rateLimitNotification } from '../lib/stores'

describe('RateLimitToast', () => {
	beforeEach(() => {
		// Reset store before each test
		rateLimitNotification.set(null)
	})

	it('renders toast when rateLimitNotification store has value', () => {
		const now = Math.floor(Date.now() / 1000)
		rateLimitNotification.set({
			reset_at: now + 300,
			timestamp: Date.now(),
		})

		render(RateLimitToast)

		const alert = screen.getByRole('button', { hidden: true })
		expect(alert).toBeTruthy()
	})

	it('hides toast when store is null', () => {
		rateLimitNotification.set(null)

		const { container } = render(RateLimitToast)

		// Should not have visible alert
		const alerts = container.querySelectorAll('.alert')
		expect(alerts.length).toBe(0)
	})

	it('shows "GitHub API rate limited" text', () => {
		const now = Math.floor(Date.now() / 1000)
		rateLimitNotification.set({
			reset_at: now + 300,
			timestamp: Date.now(),
		})

		render(RateLimitToast)

		expect(screen.getByText('GitHub API rate limited')).toBeTruthy()
	})

	it('shows reset time when reset_at is provided', () => {
		const now = Math.floor(Date.now() / 1000)
		const resetAt = now + 120 // 2 minutes from now

		rateLimitNotification.set({
			reset_at: resetAt,
			timestamp: Date.now(),
		})

		render(RateLimitToast)

		// Should show "Resets in X min"
		const resetText = screen.getByText(/Resets in/)
		expect(resetText).toBeTruthy()
	})

	it('dismiss button clears store', async () => {
		const now = Math.floor(Date.now() / 1000)
		rateLimitNotification.set({
			reset_at: now + 300,
			timestamp: Date.now(),
		})

		render(RateLimitToast)

		const dismissButton = screen.getByRole('button', { name: '✕' })
		await fireEvent.click(dismissButton)

		expect(get(rateLimitNotification)).toBeNull()
	})
})
