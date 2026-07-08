// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .portal/ folder
export const PORTAL_FOLDER_PERMISSION_PATTERN = '/.portal/**'

// Permission pattern for granting session-level access to the global ~/.portal/ folder
export const GLOBAL_PORTAL_FOLDER_PERMISSION_PATTERN = '~/.portal/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
