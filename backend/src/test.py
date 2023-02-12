# lst1 = [1,2,3]
# lst2 = lst1.copy()
# lst2[1] = 1
# print(lst1)
# print(lst2)

# lst = [
#   {"value": "one"},
#   {"value": "two"},
#   {"value": "three"},
# ]

# lst.pop(1)
# print(lst)
# # print( 2*10**5 )

# from collections import OrderedDict

# dic = OrderedDict()
# dic = {}
# dic[1] = "one"
# dic[2] = "two"
# dic[3] = "three"
# dic[4] = "four"
# lst_dic = [
#   {1: "one"},
#   {2: "two"},
#   {3: "three"},
# ]

# height = list(lst_dic[0].keys())[0]
# print(height)

# dic.popitem(last=False)

# print(dic)

# for i in range(0,5):
#   print(i)

# output = []
# item = [1,3,2]
# item.sort()
# print(item)
# if item not in output:
#   output.append(item)
# print(output)

# lst = [1,2,3]
# dic = {}
# print(str(1)+str(2)+str(3))
# dic[".join"]

# def search(arr, N, K):
#   mid = N//2
#   print("array", arr)
#   print("mid index", mid)
#   print("mid value", arr[mid])
#   while True:
#       if len(arr) > 1:
#           if arr[mid] == K:
#               return 1
#           if arr[mid] < K:
#               arr = arr[mid:]
#           else:
#               arr = arr[:mid]
#           mid = len(arr)//2
#           print("array", arr)
#           print("mid index", mid)
#           print("mid value", arr[mid])
#       else:
#           return -1
# target = 6
# arr = [1,2,3,4,6]
# output = search(arr, len(arr), target)
# print(output)

# height = 1
# val = 2
# output = str(height) + ":" + str(val)
# print(output)

# lst = [38, 27, 43, 3, 9, 82, 10]
# def merge_sort(input):
#   if len(input) > 1:
#     middle = len(input)//2
#     left = input[:middle]
#     right = input[middle:]
#     print("left", left)
#     print("right", right)

#     merge_sort(left)
#     merge_sort(right)

#     # Instantiate 3 indexes, 1 for left, 1 for right, 1 for final
#     i,j,k = 0,0,0
#     while i < len(left) and j < len(right):
#       if left[i] <= right[j]:
#         input[k] = left[i]
#         i+=1
#       else:
#         input[k] = right[j]
#         j+=1
#       k+=1
    
#     while i < len(left):
#       input[k] = left[i]
#       k+=1
#       i+=1
#     while j < len(right):
#       input[k] = right[j]
#       k+=1
#       j+=1
#     print(input)


# merge_sort(lst)
# import os
# os.system("screencapture screen.png")