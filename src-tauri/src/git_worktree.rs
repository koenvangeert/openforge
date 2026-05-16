use crate::user_environment::user_tool_path;
use dashmap::DashMap;
use log::{info, warn};
use once_cell::sync::Lazy;
use regex::Regex;
use std::fmt;
use std::io;
use std::path::Path;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;

// ============================================================================
// Error Type
// ============================================================================

#[derive(Debug)]
pub enum GitWorktreeError {
    WorktreeAddFailed(String),
    WorktreeRemoveFailed(String),
    IoError(io::Error),
}

impl fmt::Display for GitWorktreeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GitWorktreeError::WorktreeAddFailed(msg) => {
                write!(f, "Failed to add worktree: {}", msg)
            }
            GitWorktreeError::WorktreeRemoveFailed(msg) => {
                write!(f, "Failed to remove worktree: {}", msg)
            }
            GitWorktreeError::IoError(e) => {
                write!(f, "IO error: {}", e)
            }
        }
    }
}

impl std::error::Error for GitWorktreeError {}

impl From<io::Error> for GitWorktreeError {
    fn from(err: io::Error) -> Self {
        GitWorktreeError::IoError(err)
    }
}

// ============================================================================
// Data Structures
// ============================================================================

// ============================================================================
// Per-Path Locking
// ============================================================================

static WORKTREE_LOCKS: Lazy<DashMap<String, Arc<Mutex<()>>>> = Lazy::new(DashMap::new);

/// Acquires a lock for the given repository path to prevent concurrent worktree operations
fn acquire_lock(repo_path: &Path) -> Arc<Mutex<()>> {
    let path_key = repo_path.to_string_lossy().to_string();
    WORKTREE_LOCKS
        .entry(path_key)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

// ============================================================================
// Command Environment
// ============================================================================

fn git_command() -> Command {
    let mut command = Command::new("git");
    command.env("PATH", user_tool_path());
    command
}

async fn git_ref_exists(repo_path: &Path, git_ref: &str) -> Result<bool, GitWorktreeError> {
    let refspec = format!("{}^{{commit}}", git_ref);
    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("rev-parse")
        .arg("--verify")
        .arg("--quiet")
        .arg(refspec)
        .output()
        .await?;

    Ok(output.status.success())
}

async fn resolve_worktree_base_ref(
    repo_path: &Path,
    preferred_base_ref: &str,
) -> Result<String, GitWorktreeError> {
    if git_ref_exists(repo_path, preferred_base_ref).await? {
        return Ok(preferred_base_ref.to_string());
    }

    if git_ref_exists(repo_path, "HEAD").await? {
        warn!(
            "Preferred worktree base ref '{}' is unavailable; falling back to HEAD",
            preferred_base_ref
        );
        return Ok("HEAD".to_string());
    }

    Err(GitWorktreeError::WorktreeAddFailed(format!(
        "base ref '{}' is unavailable and HEAD is not a valid commit",
        preferred_base_ref
    )))
}

// ============================================================================
// Worktree Operations
// ============================================================================

/// Creates a new git worktree with a new branch based on a given reference.
/// If the worktree path already exists, it's considered a successful reuse.
///
/// # Arguments
/// * `repo_path` - Path to the main git repository
/// * `worktree_path` - Path where the worktree should be created
/// * `branch_name` - Name of the new branch to create
/// * `base_ref` - Base reference (branch/commit) to branch from
///
/// # Returns
/// Ok(()) on success, or an error describing what went wrong
pub async fn create_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
    base_ref: &str,
) -> Result<(), GitWorktreeError> {
    let lock = acquire_lock(repo_path);
    let _guard = lock.lock().await;

    let prune_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("prune")
        .output()
        .await?;

    if !prune_output.status.success() {
        let stderr = String::from_utf8_lossy(&prune_output.stderr);
        warn!("Warning: worktree prune failed: {}", stderr);
    }

    // Fetch latest from origin so the base ref (e.g. origin/main) is up to date
    let fetch_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("fetch")
        .arg("origin")
        .output()
        .await?;

    if !fetch_output.status.success() {
        let stderr = String::from_utf8_lossy(&fetch_output.stderr);
        warn!("Warning: git fetch origin failed: {}", stderr);
    }

    if worktree_path.exists() {
        return Ok(());
    }

    let resolved_base_ref = resolve_worktree_base_ref(repo_path, base_ref).await?;
    let result =
        try_create_worktree_inner(repo_path, worktree_path, branch_name, &resolved_base_ref).await;

    if result.is_err() {
        info!("Worktree creation failed, attempting cleanup and retry...");

        let _ = git_command()
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("remove")
            .arg("--force")
            .arg(worktree_path)
            .output()
            .await;

        let _ = git_command()
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("prune")
            .output()
            .await;

        return try_create_worktree_inner(
            repo_path,
            worktree_path,
            branch_name,
            &resolved_base_ref,
        )
        .await;
    }

    result
}

async fn try_create_worktree_inner(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
    base_ref: &str,
) -> Result<(), GitWorktreeError> {
    let add_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("add")
        .arg("-b")
        .arg(branch_name)
        .arg(worktree_path)
        .arg(base_ref)
        .output()
        .await?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(stderr.to_string()));
    }

    let _ = git_command()
        .arg("-C")
        .arg(worktree_path)
        .arg("branch")
        .arg("--unset-upstream")
        .output()
        .await;

    Ok(())
}

/// Removes a git worktree and cleans up all associated metadata.
/// Performs a 4-step cleanup process to ensure complete removal.
///
/// # Arguments
/// * `repo_path` - Path to the main git repository
/// * `worktree_path` - Path to the worktree to remove
///
/// # Returns
/// Ok(()) on success, or an error describing what went wrong
pub async fn remove_worktree(
    repo_path: &Path,
    worktree_path: &Path,
) -> Result<(), GitWorktreeError> {
    remove_worktree_with_branch(repo_path, worktree_path, None).await
}

pub async fn remove_worktree_with_branch(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: Option<&str>,
) -> Result<(), GitWorktreeError> {
    let lock = acquire_lock(repo_path);
    let _guard = lock.lock().await;

    // Step 1: Force remove the worktree via git
    let remove_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg(worktree_path)
        .output()
        .await?;

    if !remove_output.status.success() {
        let stderr = String::from_utf8_lossy(&remove_output.stderr);
        warn!("Warning: git worktree remove failed: {}", stderr);
    }

    // Step 2: Remove .git/worktrees metadata
    let worktree_name = worktree_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    let git_dir = repo_path.join(".git").join("worktrees").join(worktree_name);
    if git_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&git_dir) {
            warn!("Warning: failed to remove worktree metadata: {}", e);
        }
    }

    // Step 3: Force remove the filesystem directory
    if worktree_path.exists() {
        let rm_output = Command::new("rm")
            .arg("-rf")
            .arg(worktree_path)
            .output()
            .await?;

        if !rm_output.status.success() {
            let stderr = String::from_utf8_lossy(&rm_output.stderr);
            return Err(GitWorktreeError::WorktreeRemoveFailed(stderr.to_string()));
        }
    }

    // Step 4: Prune stale worktree references
    let prune_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("prune")
        .output()
        .await?;

    if !prune_output.status.success() {
        let stderr = String::from_utf8_lossy(&prune_output.stderr);
        warn!("Warning: worktree prune failed: {}", stderr);
    }

    if let Some(branch) = branch_name {
        let branch_output = git_command()
            .arg("-C")
            .arg(repo_path)
            .arg("branch")
            .arg("-D")
            .arg(branch)
            .output()
            .await?;

        if !branch_output.status.success() {
            let stderr = String::from_utf8_lossy(&branch_output.stderr);
            warn!("Warning: branch delete failed for {}: {}", branch, stderr);
        }
    }

    Ok(())
}

// ============================================================================
// Branch Name Generation
// ============================================================================

/// Generates a slugified branch name from a task ID and title.
/// Converts to lowercase, replaces non-alphanumeric characters with hyphens,
/// collapses multiple hyphens, trims, and limits to 50 characters.
///
/// # Arguments
/// * `task_id` - The task identifier (e.g., "T-5", "PROJ-123")
/// * `title` - The task title (e.g., "Add Auth Module!")
///
/// # Returns
/// A branch name in the format "{task_id}/{slug}" (e.g., "T-5/add-auth-module")
///
/// # Example
/// ```
/// let branch = slugify_branch_name("T-5", "Add Auth Module!");
/// assert_eq!(branch, "T-5/add-auth-module");
/// ```
pub fn slugify_branch_name(task_id: &str, title: &str) -> String {
    let lower = title.to_lowercase();
    let re = Regex::new(r"[^a-z0-9]+").unwrap();
    let with_hyphens = re.replace_all(&lower, "-");
    let re_collapse = Regex::new(r"-+").unwrap();
    let collapsed = re_collapse.replace_all(&with_hyphens, "-");
    let trimmed = collapsed.trim_matches('-');
    let limited = if trimmed.len() > 50 {
        &trimmed[..50]
    } else {
        trimmed
    };
    let slug = limited.trim_end_matches('-');

    format!("{}/{}", task_id, slug)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command as StdCommand, Output};

    fn git(repo_path: &Path, args: &[&str]) -> Output {
        StdCommand::new("git")
            .arg("-C")
            .arg(repo_path)
            .args(args)
            .output()
            .expect("git command should run")
    }

    fn assert_git_success(repo_path: &Path, args: &[&str]) {
        let output = git(repo_path, args);
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_committed_repo(repo_path: &Path) {
        std::fs::create_dir_all(repo_path).expect("repo directory should be created");
        assert_git_success(repo_path, &["init", "-b", "main"]);
        assert_git_success(repo_path, &["config", "user.email", "test@example.com"]);
        assert_git_success(repo_path, &["config", "user.name", "Test User"]);
        std::fs::write(repo_path.join("README.md"), "local repo\n")
            .expect("fixture file should be written");
        assert_git_success(repo_path, &["add", "README.md"]);
        assert_git_success(repo_path, &["commit", "-m", "initial"]);
    }

    #[tokio::test]
    async fn create_worktree_falls_back_to_head_when_origin_main_is_missing() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        let worktree_path = temp.path().join("worktree");

        let result = create_worktree(
            &repo_path,
            &worktree_path,
            "T-1269/local-repo",
            "origin/main",
        )
        .await;

        assert!(
            result.is_ok(),
            "local repositories without origin/main should create worktrees: {:?}",
            result.err()
        );
        assert!(worktree_path.join("README.md").exists());

        let branch_output = git(&worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"]);
        assert!(branch_output.status.success());
        assert_eq!(
            String::from_utf8_lossy(&branch_output.stdout).trim(),
            "T-1269/local-repo"
        );

        let upstream_output = git(
            &worktree_path,
            &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        );
        assert!(
            !upstream_output.status.success(),
            "created task worktree branches should not require an upstream"
        );
    }

    #[tokio::test]
    async fn resolve_worktree_base_ref_prefers_origin_main_when_available() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);
        assert_git_success(
            &repo_path,
            &["update-ref", "refs/remotes/origin/main", "HEAD"],
        );

        let base_ref = resolve_worktree_base_ref(&repo_path, "origin/main")
            .await
            .expect("origin/main should resolve when present");

        assert_eq!(base_ref, "origin/main");
    }

    #[tokio::test]
    async fn resolve_worktree_base_ref_falls_back_to_head_without_origin_main() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        init_committed_repo(&repo_path);

        let base_ref = resolve_worktree_base_ref(&repo_path, "origin/main")
            .await
            .expect("HEAD fallback should resolve for local repositories");

        assert_eq!(base_ref, "HEAD");
    }

    #[test]
    fn test_slugify_branch_name_basic() {
        let result = slugify_branch_name("T-5", "Add Auth Module!");
        assert_eq!(result, "T-5/add-auth-module");
    }

    #[test]
    fn test_slugify_branch_name_special_chars() {
        let result = slugify_branch_name("PROJ-123", "Fix: Bug with @mentions & #hashtags");
        assert_eq!(result, "PROJ-123/fix-bug-with-mentions-hashtags");
    }

    #[test]
    fn test_slugify_branch_name_multiple_spaces() {
        let result = slugify_branch_name("T-1", "Multiple   Spaces   Here");
        assert_eq!(result, "T-1/multiple-spaces-here");
    }

    #[test]
    fn test_slugify_branch_name_long_title() {
        let long_title =
            "This is a very long title that should be truncated to fifty characters maximum";
        let result = slugify_branch_name("T-999", long_title);
        assert!(result.starts_with("T-999/"));
        let slug_part = result.strip_prefix("T-999/").unwrap();
        assert!(slug_part.len() <= 50);
        assert!(!slug_part.ends_with('-'));
    }

    #[test]
    fn test_slugify_branch_name_unicode() {
        let result = slugify_branch_name("T-7", "Add 日本語 support");
        assert_eq!(result, "T-7/add-support");
    }
}
