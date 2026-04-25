/**
 * Management API - Account Routes
 * Provides CRUD operations for account management
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { managementAuthMiddleware } from '../../middleware/managementAuth'
import AccountManager from '../../../store/accounts'
import type {
  Account,
  BatchImportAccountResult,
  BatchImportAccountsRequest,
  BatchImportAccountsResponse,
  CreateAccountRequest,
  UpdateAccountRequest,
  ManagementApiResponse,
  ValidationResult
} from '../../../../../shared/types'

const router = new Router({ prefix: '/v0/management' })
const MAX_BATCH_IMPORT_ACCOUNTS = 100

/**
 * Mask sensitive credential fields
 * Replaces all credential values with '***' for security
 */
function maskCredentials(account: Account): Account {
  const maskedCredentials: Record<string, string> = {}
  for (const key of Object.keys(account.credentials)) {
    maskedCredentials[key] = '***'
  }
  
  return {
    ...account,
    credentials: maskedCredentials,
  }
}

/**
 * Create error response
 */
function createErrorResponse(code: string, message: string): ManagementApiResponse {
  return {
    success: false,
    error: {
      code,
      message,
    },
  }
}

/**
 * Create success response
 */
function createSuccessResponse<T>(data: T): ManagementApiResponse<T> {
  return {
    success: true,
    data,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateCreateAccountRequest(request: unknown): string | null {
  if (!isRecord(request)) {
    return 'Account item must be an object'
  }

  if (typeof request.providerId !== 'string' || request.providerId.trim() === '') {
    return 'Missing or invalid required field: providerId'
  }

  if (typeof request.name !== 'string' || request.name.trim() === '') {
    return 'Missing or invalid required field: name'
  }

  if (!isRecord(request.credentials)) {
    return 'Missing or invalid required field: credentials'
  }

  for (const [key, value] of Object.entries(request.credentials)) {
    if (typeof value !== 'string') {
      return `Invalid credential value for field: ${key}`
    }
  }

  if (request.email !== undefined && typeof request.email !== 'string') {
    return 'Invalid field: email'
  }

  if (request.dailyLimit !== undefined && (typeof request.dailyLimit !== 'number' || !Number.isFinite(request.dailyLimit) || request.dailyLimit < 0)) {
    return 'Invalid field: dailyLimit'
  }

  return null
}

/**
 * GET /v0/management/accounts
 * List all accounts (credentials masked)
 */
router.get('/accounts', managementAuthMiddleware, async (ctx: Context) => {
  try {
    const accounts = AccountManager.getAll(false)
    const maskedAccounts = accounts.map(maskCredentials)
    
    ctx.set('Content-Type', 'application/json')
    ctx.body = createSuccessResponse(maskedAccounts)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get accounts'
    ctx.status = 500
    ctx.body = createErrorResponse('internal_error', errorMessage)
  }
})

/**
 * GET /v0/management/providers/:providerId/accounts
 * List accounts by provider (credentials masked)
 */
router.get('/providers/:providerId/accounts', managementAuthMiddleware, async (ctx: Context) => {
  try {
    const providerId = ctx.params.providerId
    const accounts = AccountManager.getByProviderId(providerId, false)
    const maskedAccounts = accounts.map(maskCredentials)
    
    ctx.set('Content-Type', 'application/json')
    ctx.body = createSuccessResponse(maskedAccounts)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get accounts by provider'
    ctx.status = 500
    ctx.body = createErrorResponse('internal_error', errorMessage)
  }
})

/**
 * GET /v0/management/accounts/:id
 * Get account by ID (credentials masked)
 * Returns 404 if account not found
 */
router.get('/accounts/:id', managementAuthMiddleware, async (ctx: Context) => {
  try {
    const id = ctx.params.id
    const account = AccountManager.getById(id, false)
    
    if (!account) {
      ctx.status = 404
      ctx.body = createErrorResponse('account_not_found', `Account not found: ${id}`)
      return
    }
    
    const maskedAccount = maskCredentials(account)
    ctx.set('Content-Type', 'application/json')
    ctx.body = createSuccessResponse(maskedAccount)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get account'
    ctx.status = 500
    ctx.body = createErrorResponse('internal_error', errorMessage)
  }
})

/**
 * POST /v0/management/accounts
 * Create new account
 */
router.post('/accounts', managementAuthMiddleware, async (ctx: Context) => {
  try {
    const request = ctx.request.body as CreateAccountRequest

    if (!request.providerId) {
      ctx.status = 400
      ctx.body = createErrorResponse('invalid_request', 'Missing required field: providerId')
      return
    }

    if (!request.name) {
      ctx.status = 400
      ctx.body = createErrorResponse('invalid_request', 'Missing required field: name')
      return
    }

    if (!request.credentials || typeof request.credentials !== 'object') {
      ctx.status = 400
      ctx.body = createErrorResponse('invalid_request', 'Missing or invalid required field: credentials')
      return
    }

    const account = AccountManager.create({
      providerId: request.providerId,
      name: request.name,
      email: request.email,
      credentials: request.credentials,
      dailyLimit: request.dailyLimit,
    })

    const maskedAccount = maskCredentials(account)
    ctx.status = 201
    ctx.set('Content-Type', 'application/json')
    ctx.body = createSuccessResponse(maskedAccount)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to create account'

    if (errorMessage.includes('not found')) {
      ctx.status = 404
      ctx.body = createErrorResponse('provider_not_found', errorMessage)
    } else {
      ctx.status = 500
      ctx.body = createErrorResponse('internal_error', errorMessage)
    }
  }
})

/**
 * POST /v0/management/accounts/import
 * Batch import accounts
 */
router.post('/accounts/import', managementAuthMiddleware, async (ctx: Context) => {
  try {
    const request = ctx.request.body as BatchImportAccountsRequest

    if (!request || !Array.isArray(request.accounts)) {
      ctx.status = 400
      ctx.body = createErrorResponse('invalid_request', 'Missing or invalid required field: accounts')
      return
    }

    if (request.accounts.length === 0) {
      ctx.status = 400
      ctx.body = createErrorResponse('invalid_request', 'accounts must contain at least one item')
      return
    }

    if (request.accounts.length > MAX_BATCH_IMPORT_ACCOUNTS) {
      ctx.status = 400
      ctx.body = createErrorResponse('invalid_request', `accounts cannot contain more than ${MAX_BATCH_IMPORT_ACCOUNTS} items`)
      return
    }

    const results: BatchImportAccountResult[] = []

    for (const [index, accountRequest] of request.accounts.entries()) {
      const validationError = validateCreateAccountRequest(accountRequest)
      if (validationError) {
        results.push({
          index,
          success: false,
          error: {
            code: 'invalid_request',
            message: validationError,
          },
        })
        continue
      }

      try {
        const account = AccountManager.create({
          providerId: accountRequest.providerId,
          name: accountRequest.name,
          email: accountRequest.email,
          credentials: accountRequest.credentials,
          dailyLimit: accountRequest.dailyLimit,
        })

        results.push({
          index,
          success: true,
          account: maskCredentials(account),
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to create account'
        results.push({
          index,
          success: false,
          error: {
            code: errorMessage.includes('not found') ? 'provider_not_found' : 'internal_error',
            message: errorMessage,
          },
        })
      }
    }

    const imported = results.filter(result => result.success).length
    const failed = results.length - imported
    const response: BatchImportAccountsResponse = {
      total: results.length,
      imported,
      failed,
      results,
    }

    ctx.status = failed === 0 ? 201 : 200
    ctx.set('Content-Type', 'application/json')
    ctx.body = createSuccessResponse(response)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to import accounts'
    ctx.status = 500
    ctx.body = createErrorResponse('internal_error', errorMessage)
  }
})

/**
 * PUT /v0/management/accounts/:id
 * Update account
 */
router.put('/accounts/:id', managementAuthMiddleware, async (ctx: Context) => {
  try {
    const id = ctx.params.id
    const request = ctx.request.body as UpdateAccountRequest
    
    const existingAccount = AccountManager.getById(id, false)
    if (!existingAccount) {
      ctx.status = 404
      ctx.body = createErrorResponse('account_not_found', `Account not found: ${id}`)
      return
    }
    
    const updates: Partial<Omit<Account, 'id' | 'createdAt'>> = {}
    
    if (request.name !== undefined) {
      updates.name = request.name
    }
    
    if (request.email !== undefined) {
      updates.email = request.email
    }
    
    if (request.credentials !== undefined) {
      updates.credentials = request.credentials
    }
    
    if (request.dailyLimit !== undefined) {
      updates.dailyLimit = request.dailyLimit
    }
    
    const updatedAccount = AccountManager.update(id, updates)
    
    if (!updatedAccount) {
      ctx.status = 500
      ctx.body = createErrorResponse('update_failed', 'Failed to update account')
      return
    }
    
    const maskedAccount = maskCredentials(updatedAccount)
    ctx.set('Content-Type', 'application/json')
    ctx.body = createSuccessResponse(maskedAccount)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to update account'
    ctx.status = 500
    ctx.body = createErrorResponse('internal_error', errorMessage)
  }
})

/**
 * DELETE /v0/management/accounts/:id
 * Delete account
 */
router.delete('/accounts/:id', managementAuthMiddleware, async (ctx: Context) => {
  try {
    const id = ctx.params.id
    
    const deleted = AccountManager.delete(id)
    
    if (!deleted) {
      ctx.status = 404
      ctx.body = createErrorResponse('account_not_found', `Account not found: ${id}`)
      return
    }
    
    ctx.set('Content-Type', 'application/json')
    ctx.body = createSuccessResponse({ id, deleted: true })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete account'
    ctx.status = 500
    ctx.body = createErrorResponse('internal_error', errorMessage)
  }
})

/**
 * POST /v0/management/accounts/:id/validate
 * Validate account credentials
 */
router.post('/accounts/:id/validate', managementAuthMiddleware, async (ctx: Context) => {
  try {
    const id = ctx.params.id
    
    const existingAccount = AccountManager.getById(id, false)
    if (!existingAccount) {
      ctx.status = 404
      ctx.body = createErrorResponse('account_not_found', `Account not found: ${id}`)
      return
    }
    
    const validationResult: ValidationResult = await AccountManager.validate(id)
    
    ctx.set('Content-Type', 'application/json')
    ctx.body = createSuccessResponse(validationResult)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to validate account'
    ctx.status = 500
    ctx.body = createErrorResponse('internal_error', errorMessage)
  }
})

export default router
