use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BoardStatus {
    Backlog,
    Doing,
    Done,
}

impl BoardStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Backlog => "backlog",
            Self::Doing => "doing",
            Self::Done => "done",
        }
    }

    fn normalize(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "backlog" | "todo" => Some(Self::Backlog),
            "doing" | "in_progress" | "in_review" | "testing" => Some(Self::Doing),
            "done" => Some(Self::Done),
            _ => None,
        }
    }
}

impl fmt::Display for BoardStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for BoardStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::normalize(value).ok_or_else(|| format!("Invalid board status: {value}"))
    }
}
