import { IPC } from "../../ipc/client";
import {Dictionary} from "../../dictionary";

const ipc = IPC();

const Dialogs = require('dialogs');
const $ = require("jquery");
const ellipsis = require('text-ellipsis');
const electron = require('electron');
const remote = electron.remote;
const app = remote.app;
const path = require('path');
const nativeImage = electron.nativeImage;
const storage = require('electron-json-storage');

import {NodeTab} from "./tabs/node"
import {WorkspaceTab, WorkspaceTabConstructor} from "./tabs/tab";
import {DefaultTab} from "./tabs/default";
import {NodeClassTab} from "./tabs/class";
import {NodeResourceTab} from "./tabs/resource";
import {FactsTab} from "./tabs/facts";

import {puppet} from "../../puppet";
import {TreeView, TreeViewNode} from "./treeview";

const dialogs = Dialogs();
let renderer: WorkspaceRenderer;
let selectedNode: any = null;

class NodeTreeItemRenderer
{
    private renderer: WorkspaceRenderer;
    private name: string;
    private path: string;
    private localPath: string;
    private info: any;
    private classInfo: any;

    private readonly n_parent: TreeViewNode;
    private n_node: TreeViewNode;

    constructor(renderer: WorkspaceRenderer, 
        name: string, path: string, localPath: string, parentNode: TreeViewNode)
    {
        this.renderer = renderer;
        this.name = name;
        this.path = path;
        this.localPath = localPath;
        this.n_parent = parentNode;
    }

    public async init()
    {
        this.info = await ipc.findNode(this.localPath);
        this.classInfo = await renderer.getClassInfo(this.info.env);
        this.render();
    }

    private renderClasses(node: TreeViewNode, parentClassPath: string): boolean
    {
        const zis = this;
        let hadAny: boolean = false;

        const nodeClassNames = this.info.classes;
        nodeClassNames.sort();

        for (const className of nodeClassNames)
        {
            const classInfo = this.classInfo.classes[className];
            const iconData = classInfo.options.icon;

            const classNode = node.addChild( 
                (node) => 
            {
                if (iconData != null)
                {
                    node.icon = $('<img class="node-entry-icon" src="' + iconData + 
                        '" style="width: 16px; height: 16px;">');
                }
                else
                {
                    node.icon = $('<i class="node-entry-icon fas fa-puzzle-piece"></i>');
                }

                node.title = className;
                node.leaf = true;
                node.selectable = true;
                node.onSelect = (node) => 
                {
                    renderer.openTab("class", [zis.localPath, className]);
                };
            }, "class-" + zis.localPath + "-" + className, renderer.openNodes);
            
            classNode.contextMenu([
                {
                    label: "Copy",
                    click: () => {
                        //
                    }
                },
                {
                    label: "Reset To Defaults",
                    click: async () => 
                    {
                        await ipc.removeNodeClassProperties(zis.localPath, className);
                        await renderer.refreshTabKind("class", [zis.localPath, className]);
                    }
                },
                {
                    type: "separator"
                },
                {
                    label: "Remove",
                    click: async () => 
                    {
                        await ipc.removeClassFromNode(zis.localPath, className);
                        await renderer.refresh();
                        await renderer.closeTabKind("class", [zis.localPath, className]);
                    }
                }
            ]);

            hadAny = true;
        }

        return hadAny;
    }
    
    private renderResources(node: TreeViewNode, parentClassPath: string): boolean
    {
        const zis = this;
        let hadAny: boolean = false;

        const nodeResources = this.info.resources;
        const nodeResourcesNames = Object.keys(nodeResources);
        nodeResourcesNames.sort();

        for (const definedTypeName of nodeResourcesNames)
        {
            const resourceTypeInfo = this.classInfo.types[definedTypeName];
            const iconData = resourceTypeInfo.options.icon;

            const resourceNode = node.addChild( 
                (node) => 
            {
                if (iconData != null)
                {
                    node.icon = $('<img class="node-entry-icon" src="' + iconData + 
                        '" style="width: 16px; height: 16px;">');
                }
                else
                {
                    node.icon = $('<i class="node-entry-icon fas fa-puzzle-piece"></i>');
                }

                node.title = definedTypeName;
                node.leaf = false;
            }, "resources-" + zis.localPath + "-" + definedTypeName, renderer.openNodes);
            
            resourceNode.contextMenu([
                {
                    label: "Create New Resource",
                    click: async () => 
                    {
                        const newTitle = await new Promise<string>((resolve: any) => {
                            dialogs.prompt("Enter a title for new resource " + definedTypeName, "", (result: string) =>
                            {
                                resolve(result);
                            })
                        });
    
                        if (newTitle == null)
                            return;
    
                        if (!(await ipc.createNewResourceToNode(zis.localPath, definedTypeName, newTitle)))
                            return;
    
                        await renderer.refresh();
                        await renderer.closeTabKind("resource", 
                            [zis.localPath, definedTypeName, newTitle]);
                    }
                },
                {
                    type: "separator"
                },
                {
                    label: "Remove All",
                    click: async () => 
                    {
                        const names = await ipc.removeResourcesFromNode(zis.localPath, definedTypeName);
                        await renderer.refresh();
                        for (const name of names)
                        {
                            await renderer.closeTabKind("resource", [zis.localPath, definedTypeName, name]);
                        }
                    }
                }
            ]);
            
            const titles = nodeResources[definedTypeName];

            for (const title of titles)
            {
                const resourceNameNode = resourceNode.addChild( 
                    (node) => 
                {
                    node.icon = $('<i class="node-entry-icon far fa-clone"></i>');
                    node.title = title;
                    node.selectable = true;
                    node.leaf = true;
                    node.onSelect = (node) => 
                    {
                        renderer.openTab("resource", [zis.localPath, definedTypeName, title]);
                    };
                }, "resource-" + zis.localPath + "-" + definedTypeName + "-" + title, renderer.openNodes);
                
                resourceNameNode.contextMenu([
                    {
                        label: "Rename",
                        click: async () => 
                        {
                            const newTitle = await new Promise<string>((resolve: any) => {
                                dialogs.prompt("Enter new name for resource " + definedTypeName, title, (result: string) =>
                                {
                                    resolve(result);
                                })
                            });

                            if (newTitle == null || newTitle == title)
                                return;

                            if (!(await ipc.renameNodeResource(zis.localPath, definedTypeName, title, newTitle)))
                                return;

                            await renderer.refresh();
                            
                            if (await renderer.closeTabKind("resource", [zis.localPath, definedTypeName, title]))
                            {
                                await renderer.openTab("resource", [zis.localPath, definedTypeName, newTitle])
                            }
                        }
                    },
                    {
                        type: "separator"
                    },
                    {
                        label: "Remove",
                        click: async () => 
                        {
                            await ipc.removeResourceFromNode(zis.localPath, definedTypeName, title);
                            await renderer.refresh();
                            await renderer.closeTabKind("resource", [zis.localPath, definedTypeName, title]);
                        }
                    }
                ]);
            }

            hadAny = true;
        }

        return hadAny;
    }

    private render()
    {
        const zis = this;

        this.n_node = this.n_parent.addChild( 
            (node) => 
        {
            node.icon = $('<i class="fa fa-server"></i>');
            node.title = zis.name;
            node.selectable = false;
        }, "node-" + zis.localPath, renderer.openNodes);

        this.n_node.contextMenu([
            {
                label: "Assign New Class",
                click: async () => 
                {
                    const className = await ipc.assignNewClassToNode(zis.localPath);

                    if (className)
                    {
                        await renderer.refresh();
                        renderer.openTab("class", [zis.localPath, className]);
                    }
                }
            },
            {
                label: "Create New Resource",
                click: () => {
                    //
                }
            },
            {
                type: "separator"
            },
            {
                label: "Remove",
                click: () => {
                    //
                }
            }
        ])

        const n_classes = this.n_node.addChild( 
            (node) => 
        {
            node.icon = $('<i class="fas fa-puzzle-piece"></i>');
            node.title = "Classes";
            node.emptyText = "Node has no classes";
            node.leaf = false;
            node.selectable = false;
        }, "node-" + zis.localPath + "-classes", renderer.openNodes);

        this.renderClasses(n_classes, null);

        n_classes.contextMenu([
            {
                label: "Assign New Class",
                click: async () => 
                {
                    const className = await ipc.assignNewClassToNode(zis.localPath);

                    if (className)
                    {
                        await renderer.refresh();
                        renderer.openTab("class", [zis.localPath, className]);
                    }
                }
            },
            {
                type: "separator"
            },
            {
                label: "Remove All Classes",
                click: async () => 
                {
                    const classNames = await ipc.removeClassesFromNode(zis.localPath);
                    await renderer.refresh();
                    for (const className of classNames)
                    {
                        await renderer.closeTabKind("class", [zis.localPath, className]);
                    }
                }
            }
        ]);

        const n_resources = this.n_node.addChild( 
            (node) => 
        {
            node.icon = $('<i class="far fa-clone"></i>');
            node.title = "Resources";
            node.emptyText = "Node has no resources";
            node.leaf = false;
            node.selectable = false;
        }, "node-" + zis.localPath + "-resources", renderer.openNodes);
        
        n_resources.contextMenu([
            
            {
                label: "Create New Resource",
                click: async () => 
                {
                    const definedTypeName = await ipc.chooseDefinedType(zis.localPath);
                    if (!definedTypeName)
                        return;

                    const newTitle = await new Promise<string>((resolve: any) => {
                        dialogs.prompt("Enter a title for new resource " + definedTypeName, "", (result: string) =>
                        {
                            resolve(result);
                        })
                    });

                    if (newTitle == null)
                        return;

                    if (!(await ipc.createNewResourceToNode(zis.localPath, definedTypeName, newTitle)))
                        return;

                    await renderer.refresh();
                    await renderer.closeTabKind("resource", 
                        [zis.localPath, definedTypeName, newTitle]);
                }
            },
            {
                type: "separator"
            },
            {
                label: "Remove All Resources",
                click: async () => 
                {
                    const removed = await ipc.removeAllResourcesFromNode(zis.localPath);

                    await renderer.refresh();

                    for (const obj of removed)
                    {
                        await renderer.closeTabKind("resource", 
                            [zis.localPath, obj[0], obj[1]]);
                    }
                }
            }
        ]);

        this.renderResources(n_resources, null);
        
        const n_facts = this.n_node.addChild( 
            (node) => 
        {
            node.icon = $('<i class="fas fa-bars"></i>');
            node.title = "Facts";
            node.leaf = true;
            node.selectable = true;
            node.onSelect = (node: TreeViewNode) => 
            {
                renderer.openTab("facts", [zis.localPath]);
            };
        }, "node-" + zis.localPath + "-facts", renderer.openNodes);
        
    }
}

class FolderTreeItemRenderer
{
    private renderer: WorkspaceRenderer;
    private nodes: Dictionary<string, NodeTreeItemRenderer>;
    private folders: Dictionary<string, FolderTreeItemRenderer>;
    private name: string;
    private root: boolean;
    private localPath: string;

    private readonly n_parent: TreeViewNode;
    private n_nodes: TreeViewNode;

    constructor(renderer: WorkspaceRenderer, name: string, parentNode: TreeViewNode, localPath: string, root: boolean)
    {
        this.renderer = renderer;
        this.name = name;
        this.nodes = new Dictionary();
        this.folders = new Dictionary();
        this.root = root;
        this.localPath = localPath;

        this.n_parent = parentNode;

        this.render();
    }

    private render()
    {
        if (this.root)
        {
            this.n_nodes = this.n_parent;
        }
        else
        {
            const zis = this;

            this.n_nodes = this.n_parent.addChild( 
                (node) => 
            {
                node.title = zis.name;
                node.icon = $('<i class="fa fa-folder"></i>');
            }, "folder-" + zis.localPath, renderer.openNodes);

            this.n_nodes.contextMenu([
                {
                    label: "Create New Node",
                    click: () => {
                        //
                    }
                },
                {
                    type: "separator"
                },
                {
                    label: "Delete This Directory",
                    click: () => {
                        //
                    }
                }
            ])
        }
    }

    public addNode(name: string, path: string, localPath: string): NodeTreeItemRenderer
    {
        const node = new NodeTreeItemRenderer(this.renderer, name, path, localPath, this.n_nodes);
        this.nodes.put(name, node);
        return node;
    }

    public addFolder(name: string): FolderTreeItemRenderer
    {
        const folder = new FolderTreeItemRenderer(this.renderer, name, this.n_nodes, this.localPath + "/" + name, false);
        this.folders.put(name, folder);
        return folder;
    }

    public async populate(tree: any)
    {
        for (const folderEntry of tree.folders)
        {
            const name: string = folderEntry.name;
            const folder: FolderTreeItemRenderer = this.addFolder(name);
            await folder.populate(folderEntry);
        }

        for (const nodeEntry of tree.nodes)
        {
            const node = this.addNode(nodeEntry.name, nodeEntry.path, nodeEntry.localPath);
            await node.init();
        }
    }
}

class EnvironmentTreeItemRenderer
{
    private renderer: WorkspaceRenderer;
    private root: FolderTreeItemRenderer;
    private name: string;

    private n_environment: TreeViewNode;
    private readonly n_treeView: TreeViewNode;

    constructor(renderer: WorkspaceRenderer, name: string, treeView: TreeViewNode)
    {
        this.renderer = renderer;
        this.name = name;

        this.n_treeView = treeView;

        this.render();
        this.root = new FolderTreeItemRenderer(renderer, "root", this.n_environment, "root", true);
    }

    private render()
    {
        const zis = this;

        this.n_environment = this.n_treeView.addChild( 
            (node) => 
        {
            node.title = zis.name;
            node.bold = true;
            node.emptyText = "No nodes";
            node.icon = $('<i class="ic ic-environment"/>');
        }, "environment-" + this.name, renderer.openNodes);
        
    }

    public async init()
    {
        electron.ipcRenderer.on('refreshWorkspaceCategory', function(event: any, text: number)
        {
            $('#loading-category').text(text);
        });

        electron.ipcRenderer.on('refreshWorkspaceProgress', function(event: any, progress: number)
        {
            const p = Math.floor(progress * 100);
            $('#loading-progress').css('width', "" + p + "%");
        });

        const tree = await ipc.getEnvironmentTree(this.name);
        await this.root.populate(tree);
    }
}

export class WorkspaceRenderer
{
    settingsTimer: NodeJS.Timer;
    environments: Dictionary<string, EnvironmentTreeItemRenderer>;
    tabs: Dictionary<string, WorkspaceTab>;
    private workspaceTree: TreeView;
    private cachedClassInfo: any;

    private readonly tabClasses: Dictionary<string, WorkspaceTabConstructor>;
    n_editorTabs: any;
    n_editorContent: any;

    private _openNodes: Set<string>;

    constructor()
    {
        this._openNodes = new Set<string>();
        this.cachedClassInfo = {};

        this.environments = new Dictionary();
        this.tabs = new Dictionary();

        this.tabClasses = new Dictionary();
        
        this.tabClasses.put("node", NodeTab);
        this.tabClasses.put("default", DefaultTab);
        this.tabClasses.put("class", NodeClassTab);
        this.tabClasses.put("resource", NodeResourceTab);
        this.tabClasses.put("facts", FactsTab);

        this.init();
    }

    public get openNodes(): Set<string>
    {
        return this._openNodes;
    }

    public async getClassInfo(env: string): Promise<any>
    {
        if (this.cachedClassInfo.hasOwnProperty(env))
        {
            return this.cachedClassInfo[env];
        }

        const classInfo = await ipc.getClassInfo(env);
        this.cachedClassInfo[env] = classInfo;
        return classInfo;
    }

    public async refresh()
    {
        this.workspaceTree.clear();

        const environments: string[] = await ipc.getEnvironmentList();

        this.environments = new Dictionary();

        for (const environment of environments)
        {
            const env = this.addEnvironment(environment);
            await env.init();
        }
    }

    private async init()
    {
        this.initSidebar();

        WorkspaceRenderer.OpenLoading();

        const path: string = await ipc.getCurrentWorkspacePath();

        if (path != null)
        {
            document.title = ellipsis(path, 80, {side: 'start'});
        }

        this.workspaceTree = new TreeView($('#workspace'));

        const environments: string[] = await ipc.getEnvironmentList();

        await ipc.refreshWorkspace();

        for (const environment of environments)
        {
            const env = this.addEnvironment(environment);
            await env.init();
        }

        await this.enable();
    }

    public addEnvironment(name: string): EnvironmentTreeItemRenderer
    {
        const environment = new EnvironmentTreeItemRenderer(this, name, this.workspaceTree.root);
        this.environments.put(name, environment);
        return environment;
    }

    private static OpenLoading()
    {
        $('#workspace-contents').html('<div class="vertical-center h-100"><div><p class="text-center">' +
            '<span class="text text-muted"><i class="fas fa-cog fa-4x fa-spin"></i></span></p>' +
            '<p class="text-center"><span class="text text-muted" id="loading-category">' +
            'Please wait while the workspace is updating cache</span></p>' +
            '<p class="text-center"><div class="progress" style="width: 400px;">' +
            '<div class="progress-bar progress-bar-striped progress-bar-animated" ' +
            'id="loading-progress" role="progressbar" aria-valuenow="0" ' +
            'aria-valuemin="0" aria-valuemax="100" style="width:0">' +
            '</div></div></p></div></div>');
    }

    private openEditor()
    {
        const root = $('#workspace-contents');
        root.html('');
        const contents = $('<div class="h-100 h-100" style="display: flex; overflow: hidden; ' +
            'flex-direction: column;"></div>').appendTo(root);

        this.n_editorTabs = $('<ul class="nav nav-tabs compact" role="tablist"></ul>').appendTo(contents);
        this.n_editorContent = $('<div class="tab-content w-100 h-100" style="overflow-y: auto;"></div>').appendTo(contents);
    }

    private async checkEmpty()
    {
        const keys = this.tabs.getKeys();
        if (keys.length == 0)
        {
            await this.openTab("default", []);
        }
        else if (keys.length > 0)
        {
            const hasDefault = keys.indexOf("default") >= 0;

            if (hasDefault && keys.length > 1)
            {
                await this.closeTab("default");
            }
        }
    }

    public async openTab(kind: string, path: Array<string>): Promise<any>
    {
        const key = path.length > 0 ? kind + "_" + path.join("_") : kind;

        if (this.tabs.has(key))
        {
            const tab = this.tabs.get(key);

            $(tab.buttonNode).find('a').tab('show');
            return;
        }

        const fixedPath = key.replace(/:/g, '_');

        const _class: WorkspaceTabConstructor = this.tabClasses.get(kind);
        if (!_class)
            return;

        const tabButton = $('<li class="nav-item">' +
            '<a class="nav-link" id="' + fixedPath + '-tab" data-toggle="tab" href="#' + fixedPath + '" ' +
            'role="tab" aria-controls="' + fixedPath + '" aria-selected="false"></a>' +
            '</li>').appendTo(this.n_editorTabs);

        const tabContents = $('<div class="tab-pane h-100" id="' + fixedPath +
            '" role="tabpanel" aria-labelledby="' + fixedPath + '-tab">' +
            '</div>').appendTo(this.n_editorContent);

        const _tab = new _class(path, tabButton, tabContents, this);

        await _tab.init();
        _tab.render();
        const _a = $(tabButton).find('a');

        const _icon = _tab.getIcon();
        if (_icon)
        {
            _icon.addClass('tab-icon').appendTo(_a);
        }

        const shortTitle = _tab.shortTitle;
        let foundOtherTabWithSameTitle = false;

        for (const otherTab of this.tabs.getValues())
        {
            if (otherTab.shortTitle == shortTitle)
            {
                otherTab.changeTitle(otherTab.fullTitle);
                foundOtherTabWithSameTitle = true;
                break;
            }
        }

        $('<span>' + (foundOtherTabWithSameTitle ? _tab.fullTitle : _tab.shortTitle) + '</span>').appendTo(_a);

        if (_tab.canBeClosed)
        {
            const _i = $('<i class="fas fa-times close-btn"></i>').appendTo(_a).click(async () => {
                await this.closeTab(key);
            });
        }

        _a.tab('show');

        this.tabs.put(key, _tab);

        await this.checkEmpty();
    }

    public async closeTabKind(kind: string, path: Array<string>): Promise<boolean>
    {
        const key = path.length > 0 ? kind + "_" + path.join("_") : kind;
        return await this.closeTab(key);
    }

    public async refreshTabKind(kind: string, path: Array<string>): Promise<any>
    {
        const key = path.length > 0 ? kind + "_" + path.join("_") : kind;
        await this.refreshTab(key);
    }

    public async refreshTab(key: string): Promise<void>
    {
        if (!this.tabs.has(key))
            return;

        const tab = this.tabs.get(key);
        await tab.refresh();
    }

    public async closeTab(key: string): Promise<boolean>
    {
        if (!this.tabs.has(key))
            return false;

        const tab = this.tabs.get(key);
        await tab.release();

        const btn = tab.buttonNode;

        if (btn.prev().length)
        {
            btn.prev().find('a').tab('show');
        }
        else if (btn.next().length)
        {
            btn.next().find('a').tab('show');
        }

        btn.remove();
        tab.contentNode.remove();

        const shortTitle = tab.shortTitle;
        let cnt = 0;
        let otherFoundTab = null;

        this.tabs.remove(key);

        for (const otherTab of this.tabs.getValues())
        {
            if (otherTab.shortTitle == shortTitle)
            {
                cnt++;
                otherFoundTab = otherTab;
            }
        }

        if (cnt == 1)
        {
            otherFoundTab.changeTitle(otherFoundTab.shortTitle);
        }

        await this.checkEmpty();
        return true;
    }

    private async enable()
    {
        $('#workspace').removeClass('disabled');
        this.openEditor();
        await this.checkEmpty();
    }

    private initSidebar()
    {
        const sidebarMin = 200;
        const sidebarMax = 3600;
        const contentsMin = 200;

        const sideBar = $('.workspace-sidebar');
        const zis = this;

        storage.get('workspace-window-settings', function(error: any, data: any)
        {
            if (!error)
            {
                const x: any = data["x"];
                WorkspaceRenderer.applyWorkspaceSettings(x);
            }

            // noinspection TypeScriptValidateJSTypes
            $('.split-bar').mousedown(function (e: any)
            {
                e.preventDefault();

                $('#workspace-panel').addClass('workspace-frame-dragging');

                const move = function (e: any)
                {
                    e.preventDefault();

                    const x = e.pageX - sideBar.offset().left;
                    if (x > sidebarMin && x < sidebarMax && e.pageX < ($(window).width() - contentsMin))
                    {
                        WorkspaceRenderer.applyWorkspaceSettings(x);
                        zis.saveWorkspaceSettings(x);
                    }
                };

                // noinspection TypeScriptValidateJSTypes
                $(document).on('mousemove', move).mouseup(function (e: any)
                {
                    $('#workspace-panel').removeClass('workspace-frame-dragging');
                    $(document).unbind('mousemove', move);
                });
            });
        });
    }

    private static applyWorkspaceSettings(x: any)
    {
        $('.workspace-sidebar').css("width", x);
        $('.workspace-contents').css("margin-left", x);
    }

    private saveWorkspaceSettings(x: any)
    {
        if (this.settingsTimer)
        {
            clearTimeout(this.settingsTimer);
        }

        this.settingsTimer = setTimeout(() =>
        {
            storage.set('workspace-window-settings', {
                "x": x
            });
        }, 1000);
    }
}

// @ts-ignore
window.eval = global.eval = function () {
    throw new Error(`Sorry, this app does not support window.eval().`)
};

$(() =>
{
    renderer = new WorkspaceRenderer();
});
