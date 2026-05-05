use serde::Serialize;
use std::{
    any::{Any, TypeId},
    collections::HashMap,
    ops::Deref,
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
pub struct AppHandle {
    inner: Arc<AppHandleInner>,
}

#[derive(Default)]
struct AppHandleInner {
    states: Mutex<HashMap<TypeId, &'static (dyn Any + Send + Sync)>>,
    app_data_dir: Mutex<Option<PathBuf>>,
    resource_dir: Mutex<Option<PathBuf>>,
}

impl AppHandle {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub fn with_resource_dir(resource_dir: PathBuf) -> Self {
        let app = Self::default();
        app.set_resource_dir(resource_dir);
        app
    }

    pub fn with_app_paths(app_data_dir: PathBuf, resource_dir: PathBuf) -> Self {
        let app = Self::default();
        app.set_app_data_dir(app_data_dir);
        app.set_resource_dir(resource_dir);
        app
    }

    pub fn set_app_data_dir(&self, app_data_dir: PathBuf) {
        if let Ok(mut dir) = self.inner.app_data_dir.lock() {
            *dir = Some(app_data_dir);
        }
    }

    pub fn set_resource_dir(&self, resource_dir: PathBuf) {
        if let Ok(mut dir) = self.inner.resource_dir.lock() {
            *dir = Some(resource_dir);
        }
    }

    pub fn manage<T>(&self, state: T)
    where
        T: Any + Send + Sync + 'static,
    {
        let leaked: &'static (dyn Any + Send + Sync) = Box::leak(Box::new(state));
        if let Ok(mut states) = self.inner.states.lock() {
            states.insert(TypeId::of::<T>(), leaked);
        }
    }

    pub fn emit<T: Serialize>(&self, _event_name: &str, _payload: T) -> Result<(), String> {
        Ok(())
    }

    pub fn state<T>(&self) -> State<'static, T>
    where
        T: Any + Send + Sync + 'static,
    {
        self.try_state::<T>().unwrap_or_else(|| {
            panic!(
                "managed backend state not found: {}",
                std::any::type_name::<T>()
            )
        })
    }

    pub fn try_state<T>(&self) -> Option<State<'static, T>>
    where
        T: Any + Send + Sync + 'static,
    {
        let states = self.inner.states.lock().ok()?;
        let value = states.get(&TypeId::of::<T>())?;
        value.downcast_ref::<T>().map(State)
    }

    pub fn path(&self) -> AppPathResolver {
        AppPathResolver { app: self.clone() }
    }
}

#[derive(Clone)]
pub struct AppPathResolver {
    app: AppHandle,
}

impl AppPathResolver {
    pub fn app_data_dir(&self) -> Result<PathBuf, String> {
        self.app
            .inner
            .app_data_dir
            .lock()
            .map_err(|error| format!("app data dir lock error: {error}"))?
            .clone()
            .or_else(|| dirs::data_dir().map(|dir| dir.join("com.opencode.openforge")))
            .ok_or_else(|| "failed to resolve user data directory".to_string())
    }

    pub fn resource_dir(&self) -> Result<PathBuf, String> {
        self.app
            .inner
            .resource_dir
            .lock()
            .map_err(|error| format!("resource dir lock error: {error}"))?
            .clone()
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|path| path.parent().map(PathBuf::from))
            })
            .ok_or_else(|| "failed to resolve backend resource directory".to_string())
    }
}

#[derive(Clone, Copy)]
pub struct State<'a, T: ?Sized>(&'a T);

impl<'a, T: ?Sized> State<'a, T> {
    pub fn inner(&self) -> &'a T {
        self.0
    }
}

impl<T: ?Sized> Deref for State<'_, T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        self.0
    }
}
