import type { errors as Ru } from '../ru/errors';
import type { Translation } from '../types';

export const errors: Translation<typeof Ru> = {
  'errors.unauthorized': 'Your session has ended. Please sign in again',
  'errors.forbidden': 'You do not have permission for this action',
  'errors.notFound': 'Not found',
  'errors.validation': 'Please check the highlighted fields',
  'errors.conflict': 'This action is not possible in the current state',
  'errors.rateLimited': 'Too many attempts. Please try again later',
  'errors.server': 'The service is temporarily unavailable. Please try again',
  'errors.internal': 'Internal server error',
  'errors.offline': 'No connection to the server. Check your internet connection and try again',
  'errors.badResponse': 'The server returned an unexpected response. Please try again later',
  'errors.badJson': 'Invalid JSON',
  'errors.tooLarge': 'The request is too large',
  'errors.csrf': 'The request was rejected. Reload the page and try again',
  'errors.unknown': 'Something went wrong. Please try again',
  'errors.docsUnavailable': 'Documentation is unavailable',
};
