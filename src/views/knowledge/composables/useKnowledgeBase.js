import { ref, reactive, computed, nextTick, watch } from 'vue';
import { useKnowledgeStore } from '@/store';
import { coverOptions, DEFAULT_CATEGORIES } from '../constants';

// Agent 智能体目录下需要隐藏的系统目录（SKILL 由后端维护不在侧边栏展示，仅显示 SANDBOX 及用户创建的目录）
const AGENT_HIDDEN_DIRS = ['memories', 'large_tool_results', 'SKILL'];

export function useKnowledgeBase(fileSystem, sidebar, t = key => key) {
  const api = window.electronAPI;
  const knowledgeStore = useKnowledgeStore();
  const selectedKB = ref('');
  const currentTitle = ref('知识库');
  const categories = reactive(JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)).map(category => ({
    ...category,
    name: t(`knowledge.categories.${category.id}`)
  })));
  watch(
    () => [t('knowledge.categories.personal'), t('knowledge.categories.local'), t('knowledge.categories.agent')],
    ([personal, local, agent]) => {
      const labels = { personal, local, agent };
      categories.forEach(category => { category.name = labels[category.id] || category.name; });
    }
  );

  const showCreateDialog = ref(false);
  const currentCategoryId = ref('');
  const currentCategoryName = ref('');
  const kbNameInputRef = ref(null);
  const editingKBId = ref(null);
  const operationError = ref('');

  const newKB = reactive({
    name: '',
    description: '',
    coverIndex: 0
  });

  // 从磁盘目录扫描知识库列表
  async function loadCategoriesFromDisk() {
    if (!api || !fileSystem.dataDir.value) return;
    const custom = await api.invoke('kb-list-categories');
    if (custom?.success) {
      const ids = new Set(custom.data.map(item => item.id));
      for (let i = categories.length - 1; i >= 0; i--) {
        if (!DEFAULT_CATEGORIES.some(item => item.id === categories[i].id) && !ids.has(categories[i].id)) categories.splice(i, 1);
      }
      custom.data.forEach((item, index) => {
        const existing = categories.find(category => category.id === item.id);
        if (existing) {
          existing.name = item.name;
          const oldIndex = categories.indexOf(existing);
          categories.splice(oldIndex, 1);
          categories.splice(DEFAULT_CATEGORIES.length + index, 0, existing);
        } else categories.splice(DEFAULT_CATEGORIES.length + index, 0, { ...item, expanded: true, items: [] });
      });
    }
    const baseDir = fileSystem.dataDir.value + '/knowledge';
    for (const category of categories) {
      const catDir = baseDir + '/' + category.id;
      try {
        const isDefaultCategory = DEFAULT_CATEGORIES.some(item => item.id === category.id);
        const isFirstLoad = isDefaultCategory && !(await api.invoke('kb-path-exists', { path: catDir }));
        if (isDefaultCategory) {
          const result = await api.invoke('kb-create-dir', { dirPath: catDir });
          if (!result?.success) throw new Error(result?.error || '创建分类目录失败');
        }

        // 确保默认知识库文件夹存在于磁盘上
        for (const item of isFirstLoad ? category.items.filter(item => DEFAULT_CATEGORIES.some(defaultCategory => defaultCategory.id === category.id && defaultCategory.items.some(defaultItem => defaultItem.id === item.id))) : []) {
          const kbDir = catDir + '/' + item.name;
          await api.invoke('kb-create-dir', { dirPath: kbDir });
        }

        const entries = await api.invoke('kb-read-dir', { dirPath: catDir });
        category.items.splice(0, category.items.length, ...category.items.filter(item => item.protected || entries.some(entry => entry.isDirectory && entry.name === item.name)));
        // 只添加磁盘上存在但列表中没有的文件夹
        for (const entry of entries) {
          if (entry.isDirectory && !category.items.some(i => i.name === entry.name)) {
            // Agent 智能体目录下隐藏系统目录（如 memories、SKILL），仅显示 SANDBOX 及用户创建的目录
            if (category.id === 'agent' && AGENT_HIDDEN_DIRS.includes(entry.name)) {
              continue;
            }
            category.items.push({
              id: `kb-${category.id}-${entry.name}`,
              name: entry.name,
              coverIndex: null
            });
          }
        }
      } catch (e) {
        console.error(`Failed to load category ${category.id}:`, e);
      }
    }

    // 会话恢复：优先回到上次选中的知识库与停留目录（知识库/目录已删除则回退默认）
    const savedState = knowledgeStore.sessionState;
    if (savedState && savedState.selectedKB) {
      const savedCategory = categories.find(c => c.id === savedState.categoryId);
      const savedItem = savedCategory?.items.find(
        i => i.id === savedState.selectedKB || i.name === savedState.title
      );
      if (savedItem) {
        await selectKnowledgeBase(savedItem.id, savedItem.name, savedCategory.id);
        const kbRoot = fileSystem.kbRootPath.value;
        const savedPath = savedState.currentPath;
        const inScope = savedPath && (savedPath === kbRoot || savedPath.startsWith(kbRoot + '/'));
        if (inScope && await api.invoke('kb-path-exists', { path: savedPath })) {
          await fileSystem.navigateTo(savedPath);
        }
        knowledgeStore.sessionState = null;
        return;
      }
    }

    // 默认选中个人知识库中的第一个知识库
    const personalCategory = categories.find(c => c.id === 'personal');
    if (personalCategory && personalCategory.items.length > 0 && !selectedKB.value) {
      const firstItem = personalCategory.items[0];
      await selectKnowledgeBase(firstItem.id, firstItem.name, personalCategory.id);
    }
  }

  const filteredCategories = computed(() => {
    if (!sidebar.searchQuery.value) return categories;
    const q = sidebar.searchQuery.value.toLowerCase();
    return categories.map(cat => ({
      ...cat,
      _matched: cat.items.some(item => item.name.toLowerCase().includes(q)) || cat.name.toLowerCase().includes(q),
      items: cat.items.filter(item => item.name.toLowerCase().includes(q)),
      expanded: true
    }));
  });

  function toggleCategory(id) {
    const category = categories.find(c => c.id === id);
    if (category) {
      category.expanded = !category.expanded;
    }
  }

  // 记录当前知识库与停留目录，供退出时会话保存使用（未选中时清空）
  watch(
    () => [selectedKB.value, currentTitle.value, currentCategoryId.value, fileSystem.currentPath.value],
    ([kbId, title, categoryId, currentPath]) => {
      knowledgeStore.sessionState = kbId
        ? { selectedKB: kbId, title, categoryId, currentPath }
        : null;
    }
  );

  async function selectKnowledgeBase(id, name, categoryId) {
    selectedKB.value = id;
    currentTitle.value = name;
    currentCategoryId.value = categoryId || '';
    await fileSystem.selectKnowledgeBaseDir(id, name, categoryId);
  }

  function addKnowledgeBase(categoryId) {
    const category = categories.find(c => c.id === categoryId);
    if (category) {
      currentCategoryId.value = categoryId;
      currentCategoryName.value = category.name;
      newKB.name = '';
      newKB.description = '';
      newKB.coverIndex = 0;
      showCreateDialog.value = true;
      nextTick(() => {
        kbNameInputRef.value?.focus();
      });
    }
  }

  function selectCover(index) {
    newKB.coverIndex = index;
  }

  function closeCreateDialog() {
    showCreateDialog.value = false;
    editingKBId.value = null;
  }

  async function confirmCreateKB() {
    if (!newKB.name.trim()) return;
    operationError.value = '';

    const category = categories.find(c => c.id === currentCategoryId.value);
    if (!category) return;

    try {
    if (/[<>:"/\\|?*\x00-\x1f]/.test(newKB.name) || /[. ]$/.test(newKB.name.trim()) || newKB.name.trim().length > 80) throw new Error('知识库名称无效');
    if (category.items.some(item => item.id !== editingKBId.value && item.name.toLocaleLowerCase() === newKB.name.trim().toLocaleLowerCase())) throw new Error('同一分类中已存在同名知识库');
    if (editingKBId.value) {
      const item = category.items.find(i => i.id === editingKBId.value);
      if (item) {
        const oldName = item.name;
        const newName = newKB.name.trim();

        // 重命名本地文件夹
        if (oldName !== newName && api && fileSystem.dataDir.value) {
          const oldPath = fileSystem.dataDir.value + '/knowledge/' + currentCategoryId.value + '/' + oldName;
          const newPath = fileSystem.dataDir.value + '/knowledge/' + currentCategoryId.value + '/' + newName;
          try {
            const result = await api.invoke('kb-rename-dir', { oldPath, newPath });
            if (!result?.success) throw new Error(result?.error || '重命名失败');
            // 如果当前正在浏览该知识库，更新路径
            if (selectedKB.value === item.id) {
              const newKbDir = newPath;
              fileSystem.kbRootPath.value = newKbDir;
              if (fileSystem.currentPath.value.startsWith(oldPath)) {
                fileSystem.currentPath.value = fileSystem.currentPath.value.replace(oldPath, newPath);
              }
            }
          } catch (e) { throw e; }
        }

        item.name = newName;
        item.description = newKB.description.trim();
        item.coverIndex = newKB.coverIndex;
        if (selectedKB.value === item.id) {
          currentTitle.value = item.name;
        }
      }
    } else {
      const newId = `kb-${Date.now()}`;
      const newItem = {
        id: newId,
        name: newKB.name.trim(),
        description: newKB.description.trim(),
        coverIndex: newKB.coverIndex
      };
      if (window.electronAPI && fileSystem.dataDir.value) {
        const kbDir = fileSystem.dataDir.value + '/knowledge/' + currentCategoryId.value + '/' + newItem.name;
        if (await api.invoke('kb-path-exists', { path: kbDir })) throw new Error('同名知识库目录已存在');
        const result = await api.invoke('kb-create-dir', { dirPath: kbDir });
        if (!result?.success) throw new Error(result?.error || '创建失败');
        fileSystem.kbRootPath.value = kbDir;
        await fileSystem.navigateTo(kbDir);
      }
      category.items.push(newItem);
      selectedKB.value = newId;
      currentTitle.value = newItem.name;
    }
    closeCreateDialog();
    } catch (error) { operationError.value = error.message; }
  }

  function editKnowledgeBase(contextMenu) {
    if (!contextMenu.item) return;
    const itemId = contextMenu.item.id;
    const categoryId = contextMenu.categoryId;
    const itemName = contextMenu.item.name || '';
    const itemDesc = contextMenu.item.description || '';
    const itemCoverIndex = contextMenu.item.coverIndex ?? 0;

    editingKBId.value = itemId;
    currentCategoryId.value = categoryId;
    const cat = categories.find(c => c.id === categoryId);
    currentCategoryName.value = cat ? cat.name : '';

    newKB.name = itemName;
    newKB.description = itemDesc;
    newKB.coverIndex = itemCoverIndex;

    showCreateDialog.value = true;
    nextTick(() => {
      kbNameInputRef.value?.focus();
    });
  }

  async function deleteKnowledgeBase(contextMenu) {
    if (!contextMenu.item) return;
    // 受保护的默认知识库（如沙盒区）不可删除
    if (contextMenu.item.protected) return;
    const categoryId = contextMenu.categoryId;
    const itemId = contextMenu.item.id;

    const category = categories.find(c => c.id === categoryId);
    if (!category) return;

    const index = category.items.findIndex(i => i.id === itemId);
    if (index !== -1) {
      // 删除本地文件夹
      if (api && fileSystem.dataDir.value) {
        const kbDir = fileSystem.dataDir.value + '/knowledge/' + categoryId + '/' + contextMenu.item.name;
        try {
          const result = await api.invoke('kb-delete-dir', { dirPath: kbDir });
          if (!result?.success) throw new Error(result?.error || '删除失败');
        } catch (e) {
          operationError.value = e.message;
          return;
        }
      }

      category.items.splice(index, 1);
      if (selectedKB.value === itemId) {
        selectedKB.value = '';
        currentTitle.value = '知识库';
        fileSystem.resetNavigation();
      }
    }
  }

  async function changeCategory(action, args) {
    operationError.value = '';
    const result = await api.invoke(`kb-${action}-category`, args);
    if (!result?.success || result.data?.success === false) {
      operationError.value = result?.error || result.data?.error || '分类操作失败';
      return false;
    }
    if (action === 'delete' && currentCategoryId.value === args.id) {
      selectedKB.value = '';
      currentCategoryId.value = '';
      currentTitle.value = '知识库';
      fileSystem.resetNavigation();
    }
    await loadCategoriesFromDisk();
    return true;
  }

  async function moveKnowledgeBaseTo(item, sourceCategoryId, targetCategoryId) {
    operationError.value = '';
    const result = await api.invoke('kb-move-knowledge-base', { name: item.name, sourceCategoryId, targetCategoryId });
    if (!result?.success) {
      operationError.value = result?.error || '移动失败';
      return false;
    }
    const wasSelected = selectedKB.value === item.id;
    if (wasSelected) {
      selectedKB.value = '';
      fileSystem.resetNavigation();
    }
    await loadCategoriesFromDisk();
    if (wasSelected) {
      const moved = categories.find(category => category.id === targetCategoryId)?.items.find(entry => entry.name === item.name);
      if (moved) await selectKnowledgeBase(moved.id, moved.name, targetCategoryId);
    }
    return true;
  }

  return {
    selectedKB,
    currentTitle,
    categories,
    filteredCategories,
    showCreateDialog,
    currentCategoryId,
    currentCategoryName,
    kbNameInputRef,
    editingKBId,
    newKB,
    coverOptions,
    loadCategoriesFromDisk,
    toggleCategory,
    selectKnowledgeBase,
    addKnowledgeBase,
    selectCover,
    closeCreateDialog,
    confirmCreateKB,
    editKnowledgeBase,
    deleteKnowledgeBase,
    changeCategory,
    moveKnowledgeBaseTo,
    operationError
  };
}
